"use client";

import { useState } from "react";
import { Card, Icon, Badge } from "@/components/ui";
import { modiSignInNow, saveModiCookie } from "./actions";

/**
 * How the app keeps its Modisoft session.
 *
 * Automatic sign-in (MODI_USERNAME / MODI_PASSWORD) is the permanent fix: the
 * app signs in again by itself whenever Modisoft lets a session lapse. Pasting
 * a cookie here is the fallback for when Modisoft blocks automated sign-in, and
 * it still beats the old routine because it takes effect at once, with no
 * Vercel variable and no redeploy.
 */
export default function ModiSignIn({
  autoLogin,
  source,
  savedAt,
}: {
  autoLogin: boolean;
  source: "login" | "manual" | "env" | "none";
  savedAt: string | null;
}) {
  const [busy, setBusy] = useState<"" | "login" | "paste">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cookie, setCookie] = useState("");
  const [showPaste, setShowPaste] = useState(!autoLogin);

  async function signIn() {
    setBusy("login");
    setMsg(null);
    try {
      const r = await modiSignInNow();
      setMsg(r.ok ? { ok: true, text: "Signed in to Modisoft. Syncs will use this session." } : { ok: false, text: r.error ?? "Sign-in failed." });
    } finally {
      setBusy("");
    }
  }

  async function paste() {
    setBusy("paste");
    setMsg(null);
    try {
      const r = await saveModiCookie(cookie);
      if (r.ok) {
        setCookie("");
        setMsg({ ok: true, text: "Cookie works and is saved. Run “Sync now” — no redeploy needed." });
      } else {
        setMsg({ ok: false, text: r.error ?? "Modisoft did not accept that cookie." });
      }
    } finally {
      setBusy("");
    }
  }

  const sourceText =
    source === "login"
      ? "Automatic sign-in"
      : source === "manual"
        ? "Pasted on this page"
        : source === "env"
          ? "MODI_COOKIE variable in Vercel"
          : "None yet";

  return (
    <Card className="p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="key" className="text-primary text-[20px]" />
          <h3 className="font-semibold text-on-surface">Modisoft sign-in</h3>
          {autoLogin ? <Badge tone="success">Automatic</Badge> : <Badge tone="warning">Manual</Badge>}
        </div>
        {autoLogin && (
          <button onClick={signIn} disabled={!!busy} className="ft-btn-secondary py-1.5">
            <Icon name={busy === "login" ? "progress_activity" : "login"} className={`text-[18px] ${busy === "login" ? "animate-spin" : ""}`} />
            {busy === "login" ? "Signing in…" : "Sign in now"}
          </button>
        )}
      </div>

      {autoLogin ? (
        <p className="text-body-sm text-on-surface-variant mt-1">
          The app signs in to Modisoft by itself, with MODI_USERNAME and MODI_PASSWORD, whenever its session
          expires. You no longer need to copy cookies.
        </p>
      ) : (
        <p className="text-body-sm text-on-surface-variant mt-1">
          <strong>Make this permanent:</strong> in Vercel → Settings → Environment Variables add{" "}
          <code className="font-mono text-[12px]">MODI_USERNAME</code> and{" "}
          <code className="font-mono text-[12px]">MODI_PASSWORD</code> (the login you use for Modisoft
          Insights) and redeploy once. After that the app signs in again by itself whenever Modisoft ends
          the session.
        </p>
      )}

      <dl className="text-body-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3">
        <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant/30 py-1">
          <dt className="text-on-surface-variant">Session in use</dt>
          <dd className="text-on-surface text-right">{sourceText}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant/30 py-1">
          <dt className="text-on-surface-variant">Saved</dt>
          <dd className="text-on-surface text-right">{savedAt ? new Date(savedAt).toLocaleString() : "—"}</dd>
        </div>
      </dl>

      {msg && (
        <p className={`mt-3 text-body-sm flex items-start gap-1.5 break-words ${msg.ok ? "text-secondary" : "text-error"}`}>
          <Icon name={msg.ok ? "check_circle" : "error"} className="text-[18px] mt-0.5 shrink-0" />
          <span>{msg.text}</span>
        </p>
      )}

      <div className="mt-3">
        {!showPaste ? (
          <button onClick={() => setShowPaste(true)} className="text-body-sm text-primary underline-offset-2 hover:underline">
            Automatic sign-in blocked? Paste a cookie instead
          </button>
        ) : (
          <div className="space-y-2">
            <label className="ft-label" htmlFor="modi-cookie">
              Paste a cookie (takes effect at once — no Vercel change, no redeploy)
            </label>
            <textarea
              id="modi-cookie"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              placeholder="ASP.NET_SessionId=…; .ASPXAUTH=…; cf_clearance=…"
              className="ft-input font-mono text-[12px] w-full"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={paste} disabled={!!busy || !cookie.trim()} className="ft-btn-primary">
                <Icon name={busy === "paste" ? "progress_activity" : "save"} className={`text-[18px] ${busy === "paste" ? "animate-spin" : ""}`} />
                {busy === "paste" ? "Testing…" : "Test & save"}
              </button>
              <span className="text-body-sm text-on-surface-variant">
                Copy the Cookie header from any request on insights.modisoft.com (DevTools → Network).
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
