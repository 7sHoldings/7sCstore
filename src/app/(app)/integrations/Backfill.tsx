"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finishBackfill } from "./actions";
import { Card, Icon } from "@/components/ui";

const CHUNK_DAYS = 10;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Pulls a full historical range in ~10-day chunks with a progress bar. */
export default function Backfill({ defaultFrom }: { defaultFrom: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(iso(new Date()));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [imported, setImported] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  async function run() {
    setError(null);
    setFinished(false);
    setImported(0);
    setDone(0);
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      setError("Pick a valid date range.");
      return;
    }

    // Build chunks.
    const chunks: [string, string][] = [];
    let cur = start;
    while (cur <= end) {
      const chunkEnd = addDays(cur, CHUNK_DAYS - 1);
      chunks.push([iso(cur), iso(chunkEnd > end ? end : chunkEnd)]);
      cur = addDays(cur, CHUNK_DAYS);
    }
    setTotal(chunks.length);
    setRunning(true);

    let sum = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        const [cFrom, cTo] = chunks[i];
        const res = await fetch("/api/sync/backfill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from: cFrom, to: cTo }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(`${cFrom}→${cTo}: ${j.error || res.statusText}`);
        }
        const j = (await res.json()) as { imported: number };
        sum += j.imported;
        setImported(sum);
        setDone(i + 1);
      }
      await finishBackfill(sum, from, to);
      setFinished(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backfill failed.");
    } finally {
      setRunning(false);
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="history" className="text-primary text-[20px]" />
        <h3 className="font-semibold text-on-surface">Backfill historical data</h3>
      </div>
      <p className="text-body-sm text-on-surface-variant mb-4">
        Pull a date range from Modisoft in chunks. Safe to re-run — each day is replaced, not duplicated.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ft-input py-1.5 text-body-sm" disabled={running} />
        </div>
        <div>
          <label className="text-label-caps uppercase text-on-surface-variant block mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ft-input py-1.5 text-body-sm" disabled={running} />
        </div>
        <button onClick={run} disabled={running} className="ft-btn-primary">
          <Icon name={running ? "sync" : "download"} className={`text-[18px] ${running ? "animate-spin" : ""}`} />
          {running ? "Backfilling…" : "Start backfill"}
        </button>
      </div>

      {(running || finished) && (
        <div className="mt-4">
          <div className="h-2 bg-surface-container rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-body-sm text-on-surface-variant mt-2">
            {finished ? "Done — " : ""}chunk {done}/{total} · imported {imported} records
            {running ? " (keep this tab open)…" : "."}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
          <Icon name="error" className="text-[18px]" /> {error}
          <span className="text-on-surface-variant"> — fix the cookie if expired, then set “From” to this date and resume.</span>
        </div>
      )}
    </Card>
  );
}
