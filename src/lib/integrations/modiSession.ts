import "server-only";
import { prisma } from "../db";

/**
 * Keeps a working Modisoft Insights session without anyone copying cookies.
 *
 * Modisoft has no API key — the Insights site only accepts a logged-in browser
 * session, and that session expires within hours. Copying the Cookie header
 * into Vercel and redeploying every time it lapsed was the only way to keep
 * syncing. This module removes that chore in two ways:
 *
 *  1. **Automatic sign-in.** With MODI_USERNAME / MODI_PASSWORD set once in
 *     Vercel, the app fills in Modisoft's own login form whenever the session
 *     it holds is refused, and saves the fresh session for every later call.
 *  2. **Saved session in the database.** Whatever session works — from the
 *     automatic sign-in, or pasted on the Integrations page — is stored in the
 *     Setting table, so changing it never needs a redeploy. The MODI_COOKIE
 *     environment variable is still honoured as the starting point.
 *
 * Cookie values never leave the server.
 */

const SETTING_KEY = "modi:session";

export type CookieSource = "login" | "manual" | "env" | "none";

export interface StoredSession {
  cookie: string;
  source: CookieSource;
  savedAt: Date | null;
}

/** Thrown when the session itself is not accepted (login page / 401). */
export class ModiSessionError extends Error {
  readonly sessionProblem = true;
}

export function isSessionError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { sessionProblem?: boolean }).sessionProblem === true;
}

export function hasCredentials(): boolean {
  return Boolean(process.env.MODI_USERNAME && process.env.MODI_PASSWORD);
}

// One cached copy per server instance, so a sync that makes many calls reads
// the database once rather than per request.
let memo: StoredSession | null = null;

/** The session to use: saved in the database first, else MODI_COOKIE. */
export async function getStoredSession(): Promise<StoredSession> {
  if (memo) return memo;
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as { cookie?: string; source?: CookieSource; savedAt?: string };
      if (parsed.cookie) {
        memo = {
          cookie: parsed.cookie,
          source: parsed.source === "manual" ? "manual" : "login",
          savedAt: parsed.savedAt ? new Date(parsed.savedAt) : null,
        };
        return memo;
      }
    }
  } catch {
    // Database unavailable or value unreadable — fall back to the env var.
  }
  const env = process.env.MODI_COOKIE ?? "";
  return env ? { cookie: env, source: "env", savedAt: null } : { cookie: "", source: "none", savedAt: null };
}

export async function saveSession(cookie: string, source: "login" | "manual"): Promise<void> {
  const value = JSON.stringify({ cookie, source, savedAt: new Date().toISOString() });
  // Remember it in memory first, so this instance uses it even if the write fails.
  memo = { cookie, source, savedAt: new Date() };
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value },
    update: { value },
  });
}

/** Forget the saved session (falls back to MODI_COOKIE / a fresh sign-in). */
export async function clearSession(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SETTING_KEY } });
  memo = null;
}

// ---------------------------------------------------------------------------
// Cookie jar
// ---------------------------------------------------------------------------

export function parseCookieHeader(header: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}

export function jarToHeader(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function setCookieLines(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const raw = res.headers.get("set-cookie");
  // Split on commas that start a new cookie (not the comma inside an Expires date).
  return raw ? raw.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

/** Apply a response's Set-Cookie headers to the jar. Returns true if anything changed. */
export function absorbCookies(jar: Map<string, string>, res: Response): boolean {
  let changed = false;
  for (const line of setCookieLines(res)) {
    const [pair, ...attrs] = line.split(";");
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expires = attrs.map((a) => a.trim()).find((a) => /^expires=/i.test(a));
    const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
    const expired =
      value === "" ||
      (maxAge && Number(maxAge.split("=")[1]) <= 0) ||
      (expires && new Date(expires.slice(8)).getTime() < Date.now());
    if (expired) {
      if (jar.delete(name)) changed = true;
    } else if (jar.get(name) !== value) {
      jar.set(name, value);
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Automatic sign-in
// ---------------------------------------------------------------------------

interface Fetched {
  res: Response;
  url: string;
  body: string;
}

/** fetch() that follows redirects itself so every hop's cookies are kept. */
async function fetchWithJar(
  url: string,
  jar: Map<string, string>,
  ua: string,
  init: { method?: string; body?: string; contentType?: string; referer?: string } = {}
): Promise<Fetched> {
  let current = url;
  let method = init.method ?? "GET";
  let body: string | undefined = init.body;
  for (let hop = 0; hop < 10; hop++) {
    const headers: Record<string, string> = {
      "user-agent": ua,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    };
    if (jar.size) headers.cookie = jarToHeader(jar);
    if (init.referer) headers.referer = init.referer;
    if (body !== undefined) {
      headers["content-type"] = init.contentType ?? "application/x-www-form-urlencoded";
      headers.origin = new URL(current).origin;
    }
    const res = await fetch(current, { method, headers, body, redirect: "manual", cache: "no-store" });
    absorbCookies(jar, res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      // 301/302/303 after a POST become a GET, as browsers do.
      if (res.status !== 307 && res.status !== 308) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return { res, url: current, body: await res.text() };
  }
  throw new Error("Modisoft sign-in redirected too many times.");
}

interface ParsedForm {
  action: string;
  method: string;
  fields: [string, string][];
  userField: string | null;
  passField: string;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Find the form with a password box and read every field it would submit. */
export function parseLoginForm(html: string): ParsedForm | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  for (const form of forms) {
    if (!/type\s*=\s*["']?password/i.test(form)) continue;
    const open = form.match(/<form\b[^>]*>/i)![0];
    const fields: [string, string][] = [];
    let userField: string | null = null;
    let userScore = -1;
    let passField = "";
    for (const tag of form.match(/<input\b[^>]*>/gi) ?? []) {
      const name = attr(tag, "name");
      if (!name) continue;
      const type = (attr(tag, "type") || "text").toLowerCase();
      const value = attr(tag, "value") ?? "";
      if (type === "password") {
        if (!passField) passField = name;
        continue;
      }
      if (type === "submit" || type === "button" || type === "image" || type === "reset" || type === "file") continue;
      if (type === "checkbox" || type === "radio") {
        // "Remember me" keeps the session alive longer — always tick it.
        if (/remember|persist|keep/i.test(name)) fields.push([name, value && value !== "on" ? value : "true"]);
        else if (/\schecked/i.test(tag)) fields.push([name, value || "on"]);
        continue;
      }
      if (type === "text" || type === "email" || type === "tel") {
        const score = /user|email|login|account/i.test(name) ? 2 : 1;
        if (score > userScore) {
          userScore = score;
          userField = name;
        }
      }
      fields.push([name, value]);
    }
    if (!passField) continue;
    return {
      action: attr(open, "action") ?? "",
      method: (attr(open, "method") || "post").toUpperCase(),
      fields,
      userField,
      passField,
    };
  }
  return null;
}

function cloudflareChallenge(res: Response, body: string): boolean {
  return (
    !!res.headers.get("cf-mitigated") ||
    /just a moment|attention required|cf-browser-verification|challenge-platform|cf-turnstile/i.test(body.slice(0, 20000))
  );
}

function loginErrorText(html: string): string | null {
  const m =
    html.match(/class\s*=\s*["'][^"']*(?:validation-summary-errors|field-validation-error|alert-danger|text-danger|error-message)[^"']*["'][^>]*>([\s\S]{0,600}?)<\/(?:div|span|p|ul)>/i);
  if (!m) return null;
  const text = decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * Sign in to Modisoft Insights with MODI_USERNAME / MODI_PASSWORD and return
 * the resulting Cookie header. `seed` carries over cookies already held (the
 * Cloudflare clearance in particular) so the sign-in looks like the same browser.
 */
export async function loginToModisoft(base: string, ua: string, seed = ""): Promise<string> {
  const username = process.env.MODI_USERNAME;
  const password = process.env.MODI_PASSWORD;
  if (!username || !password) {
    throw new ModiSessionError("MODI_USERNAME and MODI_PASSWORD are not set, so the app cannot sign in to Modisoft by itself.");
  }

  // Keep only Cloudflare's own cookies from the old session; a stale login
  // cookie would just send us back to "already signed in" pages.
  const jar = new Map<string, string>();
  for (const [k, v] of parseCookieHeader(seed)) if (/^(cf_|__cf)/i.test(k)) jar.set(k, v);

  const host = new URL(base).host;
  const candidates = [
    process.env.MODI_LOGIN_URL,
    base + "/",
    base + "/Account/Login",
    base + "/Account/LogOn",
    base + "/Login",
  ].filter(Boolean) as string[];

  let page: Fetched | null = null;
  let form: ParsedForm | null = null;
  for (const url of candidates) {
    const got = await fetchWithJar(url, jar, ua);
    if (cloudflareChallenge(got.res, got.body)) {
      throw new Error(
        `Cloudflare put a browser check in front of ${host}'s sign-in page, so the app could not sign in by itself. ` +
          "Paste a fresh cookie on the Integrations page (no redeploy needed) to get going, and the app will " +
          "keep that session alive from there."
      );
    }
    const f = parseLoginForm(got.body);
    if (f) {
      page = got;
      form = f;
      break;
    }
  }
  if (!page || !form) {
    throw new Error(
      `Could not find the sign-in form on ${host}. If Modisoft signs you in at a different address, ` +
        "set MODI_LOGIN_URL to that page in Vercel."
    );
  }
  if (/g-recaptcha|h-captcha|hcaptcha|cf-turnstile/i.test(page.body)) {
    throw new Error(
      `${host}'s sign-in form has a CAPTCHA, which an app cannot fill in. Paste a fresh cookie on the ` +
        "Integrations page instead (no redeploy needed)."
    );
  }

  const params = new URLSearchParams();
  for (const [k, v] of form.fields) {
    if (k === form.userField) continue;
    params.append(k, v);
  }
  params.set(form.userField ?? "UserName", username);
  params.set(form.passField, password);
  // Extra fields some accounts need (e.g. a company code): "Name=value&Other=value".
  if (process.env.MODI_LOGIN_EXTRA) {
    for (const [k, v] of new URLSearchParams(process.env.MODI_LOGIN_EXTRA)) params.set(k, v);
  }

  const action = new URL(form.action || page.url, page.url).toString();
  const after = await fetchWithJar(action, jar, ua, {
    method: form.method === "GET" ? "GET" : "POST",
    body: form.method === "GET" ? undefined : params.toString(),
    referer: page.url,
  });

  if (cloudflareChallenge(after.res, after.body)) {
    throw new Error(`Cloudflare blocked the sign-in request to ${host}. Paste a fresh cookie on the Integrations page instead.`);
  }
  if (parseLoginForm(after.body)) {
    const why = loginErrorText(after.body);
    throw new Error(
      `Modisoft did not accept the sign-in for ${username}` +
        (why ? `: "${why}"` : ".") +
        " Check MODI_USERNAME and MODI_PASSWORD in Vercel (and MODI_LOGIN_EXTRA if your login asks for more)."
    );
  }
  if (/two.?factor|verification code|one.?time (pass)?code|authenticator/i.test(after.body) && /<input\b/i.test(after.body)) {
    throw new Error(
      `Modisoft asked for a verification code after signing in as ${username}. Turn off two-step ` +
        "verification for this login (or create a separate reporting user without it) so the app can sign in."
    );
  }
  if (!jar.size) throw new Error(`Signing in to ${host} returned no session cookie.`);
  return jarToHeader(jar);
}
