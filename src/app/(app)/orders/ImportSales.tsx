"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";

/**
 * Upload a Modisoft Inventory export to feed the forecast.
 *
 * Why an upload and not a live pull: the reporting site is behind a Cloudflare
 * challenge whose clearance cookie is tied to the browser and network that
 * solved it, so a copied session stops working the moment the app replays it.
 * The export is the same numbers by a route that can't expire.
 *
 * The dates are asked for because the file doesn't state its own range, and a
 * sales figure without one is meaningless — 400 units is a busy week or a quiet
 * quarter depending on it. The default start is the first GSC delivery on file,
 * which is what the shelf estimate measures against.
 *
 * Posted to a route handler rather than a server action: a full catalogue
 * export is several megabytes, past the request-body limit server actions get.
 */
export default function ImportSales({ defaultFrom }: { defaultFrom: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose the exported file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("from", from);
      body.append("to", to);
      const res = await fetch("/api/sales/import", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "The upload failed.");
      } else {
        const weeks = Math.max(1, Math.round(json.periodDays / 7));
        setMessage(
          `${json.products.toLocaleString()} products with sales over ${weeks} week${weeks === 1 ? "" : "s"}` +
            ` · ${json.matchedToGsc.toLocaleString()} of them you buy from GSC` +
            ` · read from "${json.column}"`
        );
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("The upload failed — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ft-btn-secondary py-1.5">
        <Icon name="upload_file" className="text-[18px]" />
        Upload sales export
      </button>
    );
  }

  return (
    <div className="w-full max-w-md border border-outline-variant rounded-lg p-3 bg-surface-container-lowest">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-semibold text-on-surface text-body-md">Upload sales export</div>
          <p className="text-body-sm text-on-surface-variant">
            In Modisoft: <strong>Inventory → Export</strong> for this date range, then pick the
            file here. The <strong>Sold Qty</strong> column is what the forecast reads.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ft-btn-ghost p-1 rounded-full text-on-surface-variant"
          aria-label="Close"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        <label className="text-body-sm text-on-surface-variant">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="ft-input block py-1"
          />
        </label>
        <label className="text-body-sm text-on-surface-variant">
          To
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className="ft-input block py-1"
          />
        </label>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.csv"
        className="block w-full text-body-sm mb-2"
      />

      <button type="button" onClick={upload} disabled={busy} className="ft-btn-primary py-1.5">
        {busy ? (
          <>
            <Icon name="progress_activity" className="text-[18px] animate-spin" />
            Reading…
          </>
        ) : (
          <>
            <Icon name="upload" className="text-[18px]" />
            Upload
          </>
        )}
      </button>

      {message && (
        <p className="mt-2 text-body-sm text-secondary flex items-start gap-1.5">
          <Icon name="check_circle" className="text-[16px] mt-0.5 shrink-0" />
          {message}
        </p>
      )}
      {error && (
        <p className="mt-2 text-body-sm text-error flex items-start gap-1.5">
          <Icon name="error" className="text-[16px] mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
