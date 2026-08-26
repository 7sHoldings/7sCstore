"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Badge } from "@/components/ui";
import Modal from "@/components/Modal";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { saveGscOrder, finishGscImport } from "./actions";

/**
 * Bulk importer for GSC order PDFs.
 *
 * Files are uploaded and saved ONE AT A TIME rather than as a single multipart
 * request: an order PDF is ~1 MB, and a serverless request body is capped well
 * below what a whole order history would weigh. Going file-by-file means the
 * number of orders is unlimited, each order is committed as soon as it parses,
 * and a failure part way through keeps everything already imported.
 */

interface FileResult {
  fileName: string;
  status: "pending" | "working" | "done" | "failed" | "skipped";
  orderId?: string;
  lines?: number;
  statedLines?: number | null;
  sumLineCost?: number;
  reconciles?: boolean;
  error?: string;
}

type Phase = "idle" | "running" | "done";

export default function GscUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);

  async function onRun(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const picked = fileRef.current?.files;
    if (!picked || picked.length === 0) {
      setError("Choose at least one PDF.");
      return;
    }

    const files = Array.from(picked);

    // A serverless request body is capped a few MB below this; a PDF that big
    // is rejected by the platform before it reaches the parser, so say so here
    // rather than letting it fail with an opaque network error.
    const TOO_BIG = 4 * 1024 * 1024;
    const oversized = files.filter((f) => f.size > TOO_BIG);
    if (oversized.length > 0) {
      setError(
        `${oversized.length} file${oversized.length === 1 ? " is" : "s are"} over 4 MB and would be rejected on upload: ` +
          oversized.slice(0, 3).map((f) => f.name).join(", ") +
          (oversized.length > 3 ? "…" : "") +
          ". Remove them and try again."
      );
      return;
    }

    cancelRef.current = false;
    setError(null);
    setPhase("running");
    setResults(files.map((f) => ({ fileName: f.name, status: "pending" })));

    let orders = 0;
    let lines = 0;

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) {
        setResults((prev) =>
          prev.map((r, n) => (n >= i && r.status === "pending" ? { ...r, status: "skipped" } : r))
        );
        break;
      }

      setResults((prev) => prev.map((r, n) => (n === i ? { ...r, status: "working" } : r)));

      try {
        const body = new FormData();
        body.append("files", files[i]);
        const res = await fetch("/api/gsc/parse", { method: "POST", body });
        const data = await res.json();

        if (!res.ok || data.error || !data.orders?.length) {
          const msg = data.error ?? data.failures?.[0]?.error ?? "Could not read this PDF.";
          setResults((prev) => prev.map((r, n) => (n === i ? { ...r, status: "failed", error: msg } : r)));
          continue;
        }

        const o = data.orders[0];
        const saved = await saveGscOrder({ orderId: o.orderId, lines: o.lines });
        if (saved.error) {
          setResults((prev) => prev.map((r, n) => (n === i ? { ...r, status: "failed", error: saved.error } : r)));
          continue;
        }

        orders++;
        lines += saved.saved ?? 0;
        setResults((prev) =>
          prev.map((r, n) =>
            n === i
              ? {
                  ...r,
                  status: "done",
                  orderId: o.orderId,
                  lines: saved.saved,
                  statedLines: o.statedLineCount,
                  sumLineCost: o.sumLineCost,
                  reconciles: o.reconciles,
                }
              : r
          )
        );
      } catch {
        setResults((prev) =>
          prev.map((r, n) => (n === i ? { ...r, status: "failed", error: "Upload failed." } : r))
        );
      }
    }

    if (orders > 0) await finishGscImport({ orders, lines });
    setPhase("done");
    router.refresh();
  }

  function reset() {
    cancelRef.current = false;
    setResults([]);
    setError(null);
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

  const done = results.filter((r) => r.status === "done");
  const failed = results.filter((r) => r.status === "failed");
  const finished = results.filter((r) => r.status !== "pending" && r.status !== "working").length;
  const pct = results.length ? Math.round((finished / results.length) * 100) : 0;
  const totalLines = done.reduce((s, r) => s + (r.lines ?? 0), 0);
  const mismatched = done.filter((r) => r.reconciles === false);

  return (
    <Modal
      title="Upload GSC Orders"
      onClose={() => {
        if (phase === "running") cancelRef.current = true;
        setOpen(false);
        reset();
      }}
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
            <Icon name="error" className="text-[18px]" /> {error}
          </div>
        )}

        {phase === "idle" && (
          <form onSubmit={onRun} className="space-y-4">
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
                Select your whole GSC order history — there&apos;s no limit on how many.
                They upload one at a time and each order is saved as it finishes, so you
                can close this and the imported ones stay.
              </p>
              <p className="text-body-sm text-on-surface-variant mt-1">
                Re-uploading an order you already have is safe: it replaces that order
                rather than duplicating it, and the newest order always wins on price.
              </p>
            </div>
            <button type="submit" className="ft-btn-primary w-full justify-center">
              <Icon name="upload" className="text-[18px]" /> Start import
            </button>
          </form>
        )}

        {phase !== "idle" && (
          <>
            <div>
              <div className="flex items-center justify-between text-body-sm mb-1">
                <span className="font-semibold text-on-surface">
                  {phase === "running" ? "Importing…" : "Import finished"}
                </span>
                <span className="tabular text-on-surface-variant">
                  {fmtNumber(finished)} / {fmtNumber(results.length)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-container-low overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-body-sm text-on-surface-variant mt-1">
                {fmtNumber(done.length)} order{done.length === 1 ? "" : "s"} ·{" "}
                {fmtNumber(totalLines)} line{totalLines === 1 ? "" : "s"}
                {failed.length > 0 && <span className="text-error"> · {fmtNumber(failed.length)} failed</span>}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto custom-scrollbar border border-outline-variant/60 rounded-md divide-y divide-outline-variant/40">
              {results.map((r) => (
                <div key={r.fileName} className="px-3 py-2 text-body-sm flex items-start gap-2">
                  <StatusIcon status={r.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-on-surface truncate">
                        {r.orderId ? `Order #${r.orderId}` : r.fileName}
                      </span>
                      {r.status === "done" &&
                        (r.reconciles ? <Badge tone="success">ok</Badge> : <Badge tone="warning">check</Badge>)}
                    </div>
                    {r.status === "done" && (
                      <div className="text-on-surface-variant">
                        {fmtNumber(r.lines ?? 0)}
                        {r.statedLines != null && ` of ${fmtNumber(r.statedLines)}`} lines
                        {r.sumLineCost != null && ` · ${fmtMoney(r.sumLineCost)}`}
                      </div>
                    )}
                    {r.status === "failed" && <div className="text-error">{r.error}</div>}
                    {r.status === "skipped" && <div className="text-on-surface-variant">skipped</div>}
                  </div>
                </div>
              ))}
            </div>

            {phase === "done" && mismatched.length > 0 && (
              <div className="text-body-sm text-tertiary">
                {mismatched.length} order{mismatched.length === 1 ? "" : "s"} didn&apos;t match
                their own stated totals — they were imported, but worth a look.
              </div>
            )}

            {phase === "running" ? (
              <button
                onClick={() => { cancelRef.current = true; }}
                className="ft-btn-secondary w-full justify-center"
              >
                Stop after this file
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={reset} className="ft-btn-secondary flex-1 justify-center">Import more</button>
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

function StatusIcon({ status }: { status: FileResult["status"] }) {
  const map = {
    pending: { name: "schedule", cls: "text-on-surface-variant opacity-50" },
    working: { name: "progress_activity", cls: "text-primary animate-spin" },
    done: { name: "check_circle", cls: "text-secondary" },
    failed: { name: "error", cls: "text-error" },
    skipped: { name: "remove_circle", cls: "text-on-surface-variant opacity-50" },
  } as const;
  const s = map[status];
  return <Icon name={s.name} className={`text-[18px] mt-0.5 shrink-0 ${s.cls}`} />;
}
