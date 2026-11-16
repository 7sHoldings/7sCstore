"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Upload a Modisoft item-wise export for one past month. */
export default function ProductMonthImport({ defaultMonth, uploaded }: { defaultMonth: string; uploaded: string[] }) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async () => {
    if (!file || !month) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("month", month);
      const res = await fetch("/api/summary/product-import", { method: "POST", body });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setMsg({ ok: true, text: `Saved ${j.products.toLocaleString()} products (${j.units.toLocaleString()} units) for ${month}.` });
      setFile(null);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-4" data-noexport>
      <div className="font-semibold text-on-surface mb-1">Add past months</div>
      <p className="text-body-sm text-on-surface-variant mb-3">
        In Modisoft, open <b>Inventory → Item Wise</b>, set the date range to one whole month (e.g. Oct 1 – Oct 31), turn on the
        <b> Sold Qty</b> column and export to Excel. Upload it here with the same month picked. Repeat for each month — every department fills in at once.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label-caps uppercase text-on-surface-variant">Month in the file</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-caps uppercase text-on-surface-variant">Excel / CSV file</span>
          <input type="file" accept=".xlsx,.xlsm,.csv,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-body-sm" />
        </label>
        <button type="button" onClick={upload} disabled={!file || busy} className="ft-btn-primary disabled:opacity-50">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {uploaded.length > 0 && (
        <p className="text-[12px] text-on-surface-variant mt-2">Already uploaded: {uploaded.join(", ")}</p>
      )}
      {msg && <p className={`text-body-sm mt-2 ${msg.ok ? "text-secondary" : "text-error"}`}>{msg.text}</p>}
    </div>
  );
}
