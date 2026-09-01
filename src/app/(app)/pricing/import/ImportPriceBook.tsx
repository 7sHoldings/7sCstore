"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Icon, Banner, EmptyState } from "@/components/ui";
import { fmtMoney, fmtNumber, catLabel } from "@/lib/format";
import { applyPriceBookBatch, finishPriceBookImport } from "./actions";

/** Rows per apply request — keeps each round trip well inside the time limit. */
const BATCH_SIZE = 1000;

interface ParsedRow {
  upc: string;
  name: string;
  department: string | null;
  category: string;
  sellingPrice: number;
  currentCost: number;
  size: string | null;
  unitsPerCase: number | null;
  posItemCode: string | null;
}

interface Issue {
  row: number;
  code: string;
  message: string;
  value?: string;
}

interface Preview {
  fileName: string;
  headers: string[];
  mapping: Record<string, string>;
  stats: {
    totalRows: number;
    imported: number;
    skipped: number;
    duplicates: number;
    nonStandardCodes: number;
    missingRetail: number;
    withCost: number;
    departments: number;
  };
  issues: Issue[];
  issuesTotal: number;
  rows: ParsedRow[];
}

type Phase = "idle" | "parsing" | "preview" | "applying" | "done";

const FIELD_LABELS: Record<string, string> = {
  upc: "Scan code / UPC",
  name: "Product name",
  department: "Department",
  sellingPrice: "Retail price",
  currentCost: "Cost",
  size: "Size",
  unitsPerCase: "Units per case",
  posItemCode: "Item code",
};

export default function ImportPriceBook() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{ created: number; updated: number; unchanged: number } | null>(null);

  async function onParse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setResult(null);
    setPhase("parsing");

    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/pricebook/parse", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Could not read that file.");
        setPhase("idle");
        return;
      }
      setPreview(data as Preview);
      setPhase("preview");
    } catch {
      setError("Upload failed. Check your connection and try again.");
      setPhase("idle");
    }
  }

  async function onApply() {
    if (!preview) return;
    setPhase("applying");
    setError(null);
    setDone(0);

    const totals = { created: 0, updated: 0, unchanged: 0 };
    const rows = preview.rows;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const res = await applyPriceBookBatch({ rows: batch });
      if (res.error) {
        setError(`${res.error} ${totals.created + totals.updated} items were saved before this point.`);
        setPhase("preview");
        return;
      }
      totals.created += res.created ?? 0;
      totals.updated += res.updated ?? 0;
      totals.unchanged += res.unchanged ?? 0;
      setDone(Math.min(i + BATCH_SIZE, rows.length));
    }

    await finishPriceBookImport({ fileName: preview.fileName, ...totals });
    setResult(totals);
    setPhase("done");
    router.refresh();
  }

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
    setDone(0);
    setPhase("idle");
    if (fileRef.current) fileRef.current.value = "";
  }

  const pct = preview && preview.rows.length ? Math.round((done / preview.rows.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {error && <Banner tone="error" icon="error">{error}</Banner>}

      {phase === "done" && result && (
        <Banner tone="success" icon="check_circle">
          Imported {fmtNumber(result.created + result.updated)} items — {fmtNumber(result.created)} new,{" "}
          {fmtNumber(result.updated)} updated, {fmtNumber(result.unchanged)} already current.
        </Banner>
      )}

      {/* Step 1 — choose the file */}
      {(phase === "idle" || phase === "parsing") && (
        <Card className="p-5 max-w-2xl">
          <form onSubmit={onParse} className="space-y-4">
            <div>
              <label className="ft-label" htmlFor="pb-file">Price book export</label>
              <input
                ref={fileRef}
                id="pb-file"
                name="file"
                type="file"
                accept=".xlsx,.xlsm,.csv,.tsv,.txt"
                className="ft-input"
                required
              />
              <p className="text-body-sm text-on-surface-variant mt-2">
                In Modisoft, export <strong>Inventory</strong> and upload the file here. Excel (.xlsx)
                or CSV both work — columns are matched by name, so the order doesn&apos;t matter.
              </p>
            </div>
            <button type="submit" disabled={phase === "parsing"} className="ft-btn-primary">
              {phase === "parsing" ? "Reading file…" : "Read file"}
            </button>
          </form>
        </Card>
      )}

      {/* Step 2 — preview before writing anything */}
      {preview && (phase === "preview" || phase === "applying" || phase === "done") && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Items Found" value={fmtNumber(preview.stats.imported)} />
            <Tile label="Departments" value={fmtNumber(preview.stats.departments)} />
            <Tile label="With a Price" value={fmtNumber(preview.stats.imported - preview.stats.missingRetail)} />
            <Tile
              label="With a Cost"
              value={fmtNumber(preview.stats.withCost)}
              accent={preview.stats.withCost === 0 ? "warning" : undefined}
            />
          </div>

          {/* Columns detected */}
          <Card className="p-5">
            <div className="font-semibold text-on-surface mb-3 flex items-center gap-2">
              <Icon name="table_chart" className="text-[20px] text-primary" /> Columns detected
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FIELD_LABELS).map(([field, label]) => {
                const matched = preview.mapping[field];
                return (
                  <span
                    key={field}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-body-sm border ${
                      matched
                        ? "border-secondary/40 bg-secondary-container/40 text-on-secondary-container"
                        : "border-outline-variant/60 text-on-surface-variant"
                    }`}
                  >
                    <Icon name={matched ? "check" : "remove"} className="text-[16px]" />
                    {label}
                    {matched && <span className="opacity-70">→ {matched}</span>}
                  </span>
                );
              })}
            </div>
          </Card>

          {/* What will happen */}
          <Card className="p-5">
            <div className="font-semibold text-on-surface mb-2 flex items-center gap-2">
              <Icon name="rule" className="text-[20px] text-primary" /> What this import will do
            </div>
            <ul className="text-body-sm text-on-surface-variant space-y-1.5 list-disc pl-5">
              <li>Match products on <strong>scan code</strong>, so re-running this never duplicates items.</li>
              <li>Update name, department and retail price from the export.</li>
              <li>
                <strong>Never overwrite a cost or price you already have with a zero.</strong>{" "}
                {preview.stats.withCost === 0
                  ? "This export carries no costs at all, so every existing cost is left untouched."
                  : `Only ${fmtNumber(preview.stats.withCost)} rows carry a cost; the rest leave existing costs alone.`}
              </li>
              <li>Leave stock quantities alone — this is a price book, not a stock count.</li>
            </ul>
          </Card>

          {/* Issues */}
          {preview.issuesTotal > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface flex items-center gap-2">
                <Icon name="warning" className="text-[20px] text-tertiary" />
                Rows worth a look
                <Badge tone="warning">{fmtNumber(preview.issuesTotal)}</Badge>
              </div>
              <div className="px-4 py-3 text-body-sm text-on-surface-variant border-b border-outline-variant/40">
                These are imported anyway — nothing is dropped. Fix them in Modisoft when convenient.
              </div>
              <div className="overflow-x-auto custom-scrollbar max-h-72">
                <table className="w-full text-left text-body-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                      <th className="px-4 py-2">Row</th>
                      <th className="px-4 py-2">Value</th>
                      <th className="px-4 py-2">Issue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/40">
                    {preview.issues.map((iss, n) => (
                      <tr key={`${iss.row}-${n}`}>
                        <td className="px-4 py-2 tabular text-on-surface-variant">{iss.row}</td>
                        <td className="px-4 py-2 font-medium text-on-surface truncate max-w-[16rem]">{iss.value ?? "—"}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{iss.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.issuesTotal > preview.issues.length && (
                <div className="px-4 py-2 text-body-sm text-on-surface-variant border-t border-outline-variant/40">
                  Showing the first {preview.issues.length} of {fmtNumber(preview.issuesTotal)}.
                </div>
              )}
            </Card>
          )}

          {/* Sample */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-outline-variant/60 font-semibold text-on-surface">
              Sample — first 15 items
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="bg-surface-container-low text-label-caps uppercase text-on-surface-variant">
                    <th className="px-4 py-2">Department</th>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">UPC</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                    <th className="px-4 py-2">Maps to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {preview.rows.slice(0, 15).map((r) => (
                    <tr key={r.upc} className="hover:bg-surface-container-low/50">
                      <td className="px-4 py-2 text-on-surface-variant">{r.department ?? "—"}</td>
                      <td className="px-4 py-2 font-medium text-on-surface">{r.name}</td>
                      <td className="px-4 py-2 tabular text-on-surface-variant">{r.upc}</td>
                      <td className="px-4 py-2 text-right tabular">
                        {r.sellingPrice > 0 ? fmtMoney(r.sellingPrice) : <span className="text-tertiary">none</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {r.currentCost > 0 ? fmtMoney(r.currentCost) : <span className="text-on-surface-variant">—</span>}
                      </td>
                      <td className="px-4 py-2"><Badge tone="info">{catLabel(r.category)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Apply */}
          <Card className="p-5">
            {phase === "applying" ? (
              <div>
                <div className="flex items-center justify-between mb-2 text-body-sm">
                  <span className="font-semibold text-on-surface">Importing…</span>
                  <span className="tabular text-on-surface-variant">
                    {fmtNumber(done)} / {fmtNumber(preview.rows.length)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-body-sm text-on-surface-variant mt-2">
                  Keep this page open until it finishes.
                </p>
              </div>
            ) : phase === "done" ? (
              <div className="flex flex-wrap gap-2">
                <a href="/pricing" className="ft-btn-primary">
                  <Icon name="sell" className="text-[18px]" /> View price book
                </a>
                <button onClick={reset} className="ft-btn-secondary">Import another file</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={onApply} className="ft-btn-primary">
                  <Icon name="upload" className="text-[18px] " />
                  Import {fmtNumber(preview.stats.imported)} items
                </button>
                <button onClick={reset} className="ft-btn-secondary">Choose a different file</button>
                <span className="text-body-sm text-on-surface-variant">
                  Nothing has been saved yet.
                </span>
              </div>
            )}
          </Card>
        </>
      )}

      {phase === "idle" && !preview && (
        <Card className="p-2 max-w-2xl">
          <EmptyState
            icon="upload_file"
            title="No file loaded"
            hint="Upload your Modisoft Inventory export to see exactly what will change before anything is saved."
          />
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "warning" }) {
  return (
    <Card className="p-4">
      <div className="text-label-caps uppercase text-on-surface-variant truncate">{label}</div>
      <div className={`tabular text-lg font-bold mt-1 ${accent === "warning" ? "text-tertiary" : "text-on-surface"}`}>
        {value}
      </div>
    </Card>
  );
}
