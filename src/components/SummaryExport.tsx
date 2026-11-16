"use client";
import { useState } from "react";

/**
 * Download the Monthly Summary as a picture (saves to Photos on a phone — ready
 * to send on WhatsApp), a PDF, or an Excel workbook.
 *
 * The picture is taken from the page itself: while capturing, the target gets
 * an `exporting` class (see globals.css) that lets every table grow to its full
 * width instead of scrolling, hides buttons, and shows a title block.
 */
const MAX_PIXELS = 16_000_000; // iPhone Safari's canvas limit is ~16.7M pixels

async function capture(el: HTMLElement, type: "png" | "jpeg"): Promise<{ dataUrl: string; width: number; height: number }> {
  const { toPng, toJpeg } = await import("html-to-image");
  el.classList.add("exporting");
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const width = el.scrollWidth;
    const height = el.scrollHeight;
    const pixelRatio = Math.max(1, Math.min(2, Math.sqrt(MAX_PIXELS / (width * height))));
    const opts = { pixelRatio, backgroundColor: "#ffffff", width, height, cacheBust: true, skipFonts: true };
    const dataUrl = type === "png" ? await toPng(el, opts) : await toJpeg(el, { ...opts, quality: 0.92 });
    return { dataUrl, width, height };
  } finally {
    el.classList.remove("exporting");
  }
}

async function saveFile(blob: Blob, name: string, title: string) {
  const file = new File([blob], name, { type: blob.type });
  // On phones this opens the share sheet: "Save Image" puts it in Photos,
  // or send it straight to WhatsApp.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function SummaryExport({
  targetId, fileName, excelHref,
}: {
  targetId: string;
  fileName: string;
  excelHref?: string;
}) {
  const [busy, setBusy] = useState<"" | "image" | "pdf">("");
  const [error, setError] = useState("");

  const target = () => document.getElementById(targetId);

  const image = async () => {
    const el = target();
    if (!el) return;
    setBusy("image");
    setError("");
    try {
      const { dataUrl } = await capture(el, "png");
      const blob = await (await fetch(dataUrl)).blob();
      await saveFile(blob, `${fileName}.png`, fileName);
    } catch (e) {
      console.error(e);
      setError("Couldn't create the picture. Try again, or use PDF.");
    } finally {
      setBusy("");
    }
  };

  const pdf = async () => {
    const el = target();
    if (!el) return;
    setBusy("pdf");
    setError("");
    try {
      const [{ dataUrl, width, height }, { jsPDF }] = await Promise.all([capture(el, "jpeg"), import("jspdf")]);
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 18;
      const imgW = pageW - margin * 2;
      const imgH = (height / width) * imgW;
      const usable = pageH - margin * 2;
      const pages = Math.max(1, Math.ceil(imgH / usable));
      for (let i = 0; i < pages; i++) {
        if (i > 0) doc.addPage();
        doc.addImage(dataUrl, "JPEG", margin, margin - i * usable, imgW, imgH, "summary", "FAST");
        // Mask the overflow into the margins so pages look clean.
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageW, margin, "F");
        doc.rect(0, pageH - margin, pageW, margin, "F");
      }
      await saveFile(doc.output("blob"), `${fileName}.pdf`, fileName);
    } catch (e) {
      console.error(e);
      setError("Couldn't create the PDF. Try again.");
    } finally {
      setBusy("");
    }
  };

  const btn =
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm font-medium hover:bg-surface-container disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4" data-noexport>
      <span className="text-label-caps uppercase text-on-surface-variant mr-1">Download</span>
      <button type="button" className={btn} onClick={image} disabled={!!busy}>
        <span className="material-symbols-outlined text-[18px]" aria-hidden>photo_camera</span>
        {busy === "image" ? "Creating…" : "Picture (Photos / WhatsApp)"}
      </button>
      <button type="button" className={btn} onClick={pdf} disabled={!!busy}>
        <span className="material-symbols-outlined text-[18px]" aria-hidden>picture_as_pdf</span>
        {busy === "pdf" ? "Creating…" : "PDF"}
      </button>
      {excelHref && <a className={btn} href={excelHref} download>
        <span className="material-symbols-outlined text-[18px]" aria-hidden>table_view</span>
        Excel
      </a>}
      {error && <span className="text-body-sm text-error">{error}</span>}
    </div>
  );
}
