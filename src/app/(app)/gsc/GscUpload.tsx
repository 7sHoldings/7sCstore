"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Badge } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { saveGscOrder, finishGscImport } from "./actions";

interface ParsedOrder {
  fileName: string;
  orderId: string;
  customer: string | null;
  statedLineCount: number | null;
  statedApproxCost: number | null;
  parsedLineCount: number;
  sumLineCost: number;
  reconciles: boolean;
  warnings: string[];
  lines: Record<string, unknown>[];
}

type Phase = "idle" | "parsing" | "review" | "saving" | "done";

export default function GscUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<ParsedOrder[]>([]);
  const [failures, setFailures] = useState<{ fileName: string; error: string }[]>([]);
  const [saved, setSaved] = useState(0);

  async function onParse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("Choose at least one PDF.");
      return;
    }
    setError(null);
    setPhase("parsing");

    const body = new FormData();
    for (const f of Array.from(files)) body.append("files", f);

    try {
      const res = await fetch("/api/gsc/parse", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Could not read those PDFs.");
        setPhase("idle");
        return;
      }
      setOrders(data.orders ?? []);
      setFailures(data.failures ?? []);
      setPhase("review");
    } catch {
      setError("Upload failed. Check your connection and try again.");
      setPhase("idle");
    }
  }

  async function onSave() {
    setPhase("saving");
    setError(null);
    let ok = 0;
    let lines = 0;
    for (const o of orders) {
      const res = await saveGscOrder({ orderId: o.orderId, lines: o.lines });
      if (res.error) {
        setError(`${res.error} ${ok} of ${orders.length} orders were saved.`);
        setPhase("review");
        return;
      }
      ok++;
      lines += res.saved ?? 0;
      setSaved(ok);
    }
    await finishGscImport({ orders: ok, lines });
    setPhase("done");
    router.refresh();
  }

  function reset() {
    setOrders([]);
    setFailures([]);
    setError(null);
    setSaved(0);
    setPhase("idle");
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!open) {
    return (
      <button className="ft-btn-primary" onClick={() => setOpen(true)}>
        <Icon name="upload_file" className="text-[18px]" /> Upload GSC Orders
      </button>
    );
  }

  const totalLines = orders.reduce((s, o) => s + o.parsedLineCount, 0);
  const anyMismatch = orders.some((o) => !o.reconciles);

  return (
    <Modal title="Upload GSC Orders" onClose={() => { setOpen(false); reset(); }}>
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {error}
          </div>
        )}

        {(phase === "idle" || phase === "parsing") && (
          <form onSubmit={onParse} className="space-y-4">
            <div>
              <label className="ft-label" htmlFor="gsc-files">Order PDFs</label>
              <input
                ref={fileRef}
                id="gsc-files"
                type="file"
                accept=".pdf,application/pdf"
                multiple
                required
                className="ft-input"
              />
              <p className="text-body-sm text-on-surface-variant mt-2">
                Select as many order PDFs as you like — up to 40 at a time. Uploading the
                same order twice is safe: it replaces that order rather than duplicating it,
                and the newest order always wins on price.
              </p>
            </div>
            <button type="submit" disabled={phase === "parsing"} className="ft-btn-primary w-full justify-center">
              {phase === "parsing" ? "Reading PDFs…" : "Read PDFs"}
            </button>
          </form>
        )}

        {phase !== "idle" && phase !== "parsing" && orders.length > 0 && (
          <>
            <div className="text-body-sm text-on-surface-variant">
              {fmtNumber(orders.length)} order{orders.length === 1 ? "" : "s"} ·{" "}
              {fmtNumber(totalLines)} line{totalLines === 1 ? "" : "s"}
            </div>

            <div className="max-h-64 overflow-y-auto custom-scrollbar border border-outline-variant/60 rounded-md divide-y divide-outline-variant/40">
              {orders.map((o) => (
                <div key={o.fileName} className="px-3 py-2 text-body-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-on-surface">Order #{o.orderId}</span>
                    {o.reconciles ? (
                      <Badge tone="success">reconciles</Badge>
                    ) : (
                      <Badge tone="warning">check</Badge>
                    )}
                  </div>
                  <div className="text-on-surface-variant">
                    {fmtNumber(o.parsedLineCount)}
                    {o.statedLineCount != null && ` of ${fmtNumber(o.statedLineCount)}`} lines ·{" "}
                    {fmtMoney(o.sumLineCost)}
                    {o.statedApproxCost != null && ` vs ${fmtMoney(o.statedApproxCost)} stated`}
                  </div>
                  {o.warnings.slice(0, 2).map((w, i) => (
                    <div key={i} className="text-tertiary">{w}</div>
                  ))}
                </div>
              ))}
            </div>

            {failures.length > 0 && (
              <div className="text-body-sm text-error">
                {failures.length} file{failures.length === 1 ? "" : "s"} could not be read:{" "}
                {failures.map((f) => f.fileName).join(", ")}
              </div>
            )}

            {anyMismatch && phase === "review" && (
              <div className="text-body-sm text-tertiary">
                Some orders don&apos;t match their own stated totals. They can still be imported —
                check those line counts afterwards.
              </div>
            )}

            {phase === "review" && (
              <div className="flex gap-2">
                <button onClick={reset} className="ft-btn-secondary flex-1 justify-center">Start over</button>
                <button onClick={onSave} className="ft-btn-primary flex-1 justify-center">
                  Import {fmtNumber(orders.length)} order{orders.length === 1 ? "" : "s"}
                </button>
              </div>
            )}

            {phase === "saving" && (
              <div>
                <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((saved / orders.length) * 100)}%` }} />
                </div>
                <div className="text-body-sm text-on-surface-variant mt-1 tabular">
                  Saving {saved} / {orders.length}
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="flex gap-2">
                <button onClick={reset} className="ft-btn-secondary flex-1 justify-center">Upload more</button>
                <button onClick={() => { setOpen(false); reset(); }} className="ft-btn-primary flex-1 justify-center">
                  Done
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
