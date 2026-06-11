/**
 * Supabase Storage helper for receipt photos. Uses the Storage REST API directly
 * (no extra dependency) with the service-role key, so it must only run server-side.
 *
 * Required env (set in Vercel):
 *   SUPABASE_URL                — e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — service role key (Project Settings → API)
 *   SUPABASE_RECEIPTS_BUCKET    — optional, defaults to "receipts" (create it private)
 */
import "server-only";

const BASE = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = process.env.SUPABASE_RECEIPTS_BUCKET || "receipts";

export function isStorageConfigured(): boolean {
  return Boolean(BASE && KEY);
}

/** Upload one image File and return its storage path, or null on failure. */
export async function uploadReceipt(file: File, prefix: string): Promise<string | null> {
  if (!isStorageConfigured() || !file || file.size === 0) return null;
  // Cap at ~10MB to stay within the server-action body limit.
  if (file.size > 10 * 1024 * 1024) return null;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: buf,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("Supabase upload failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    return path;
  } catch (e) {
    console.error("Supabase upload error", e);
    return null;
  }
}

/** Upload all image Files under a form field; returns the stored paths. */
export async function uploadReceiptsFromForm(formData: FormData, field: string, prefix: string): Promise<string[]> {
  const files = formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  const paths: string[] = [];
  for (const f of files) {
    const p = await uploadReceipt(f, prefix);
    if (p) paths.push(p);
  }
  return paths;
}

/** Create a time-limited signed URL to view (or download) a stored object. */
export async function signedUrl(path: string, expiresIn = 3600, download = false): Promise<string | null> {
  if (!isStorageConfigured() || !path) return null;
  try {
    const res = await fetch(`${BASE}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { signedURL?: string };
    if (!data.signedURL) return null;
    return `${BASE}/storage/v1${data.signedURL}${download ? "&download" : ""}`;
  } catch {
    return null;
  }
}

/** Signed URLs for many paths (skips ones that fail). */
export async function signedUrls(paths: string[], download = false): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const u = await signedUrl(p, 3600, download);
    if (u) out.push(u);
  }
  return out;
}
