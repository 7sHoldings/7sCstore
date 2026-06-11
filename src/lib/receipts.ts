/**
 * Receipt photo references, decoupled from the numeric entries so they never
 * affect reconciliation. Stored as a list of Supabase Storage paths per scope+id
 * (e.g. scope "credit" / id "2026-05-03"). House-payment photos live on the
 * payment record itself.
 */
import "server-only";
import { getSetting, setSetting } from "./settings";

function key(locationId: string, scope: string, id: string): string {
  return `receipts:${locationId}:${scope}:${id}`;
}

export async function getReceipts(locationId: string, scope: string, id: string): Promise<string[]> {
  const raw = await getSetting(key(locationId, scope, id));
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

export async function addReceipts(locationId: string, scope: string, id: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const existing = await getReceipts(locationId, scope, id);
  await setSetting(key(locationId, scope, id), JSON.stringify([...existing, ...paths]));
}

/** Replace the receipt list for a scope+id (used when updating an entry's photo). */
export async function setReceipts(locationId: string, scope: string, id: string, paths: string[]): Promise<void> {
  await setSetting(key(locationId, scope, id), JSON.stringify(paths));
}
