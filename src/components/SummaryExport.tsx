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

async function capture(el: HTMLElement, type: "png" | "jpeg", extra?: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const { toPng, toJpeg } = await import("html-to-image");
  // Folded sections/details open for the picture, then fold back.
  const closed = [el, ...Array.from(el.querySelectorAll("details"))].filter(
    (d): d is HTMLDetailsElement => d instanceof HTMLDetailsElement && !d.open
  );
  closed.forEach((d) => (d.open = true));
  el.classList.add("exporting");
  if (extra) el.classList.add(extra);
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Make the capture wide enough for the widest table (cards clip overflow).
    const left = el.getBoundingClientRect().left;
    const need = Math.max(
      el.scrollWidth,
      ...Array.from(el.querySelectorAll("table")).map((t) => Math.ceil(t.getBoundingClientRect().left - left + t.scrollWidth + 48))
    );
    if (need > el.getBoundingClientRect().width) {
      el.style.setProperty("width", `${need}px`, "important");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    const width = el.scrollWidth;
    const height = el.scrollHeight;
    const pixelRatio = Math.max(1, Math.min(2, Math.sqrt(MAX_PIXELS / (width * height))));
    const opts = { pixelRatio, backgroundColor: "#ffffff", width, height, cacheBust: true, skipFonts: true };
    const dataUrl = type === "png" ? await toPng(el, opts) : await toJpeg(el, { ...opts, quality: 0.92 });
    return { dataUrl, width, height };
  } finally {
    el.classList.remove("exporting");
    if (extra) el.classList.remove(extra);
    el.style.removeProperty("width");
    closed.forEach((d) => (d.open = false));
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
  targetId, fileName, excelHref, exportClass, imageLabel = "Picture (Photos / WhatsApp)",
}: {
  targetId: string;
  fileName: string;
  excelHref?: string;
  exportClass?: string; // extra class while capturing (shows a target-specific title)
  imageLabel?: string;
}) {
  const [busy, setBusy] = useState<"" | "image" | "pdf" | "excel">("");
  const [error, setError] = useState("");

  const target = () => document.getElementById(targetId);

  const image = async () => {
    const el = target();
    if (!el) return;
    setBusy("image");
    setError("");
    try {
      const { dataUrl } = await capture(el, "png", exportClass);
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
      const [{ dataUrl, width, height }, { jsPDF }] = await Promise.all([capture(el, "jpeg", exportClass), import("jspdf")]);
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

  // Fetched in the page (not a plain link) so on a phone it opens the share
  // sheet — Save to Files / WhatsApp / Excel — instead of replacing the app
  // with a file viewer that has no way back.
  const excel = async () => {
    if (!excelHref) return;
    setBusy("excel");
    setError("");
    try {
      const res = await fetch(excelHref);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${fileName}.xlsx`;
      await saveFile(await res.blob(), name, fileName);
    } catch (e) {
      console.error(e);
      setError("Couldn't create the Excel file. Try again.");
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
        {busy === "image" ? "Creating…" : imageLabel}
      </button>
      <button type="button" className={btn} onClick={pdf} disabled={!!busy}>
        <span className="material-symbols-outlined text-[18px]" aria-hidden>picture_as_pdf</span>
        {busy === "pdf" ? "Creating…" : "PDF"}
      </button>
      {excelHref && (
        <button type="button" className={btn} onClick={excel} disabled={!!busy}>
          <span className="material-symbols-outlined text-[18px]" aria-hidden>table_view</span>
          {busy === "excel" ? "Creating…" : "Excel"}
        </button>
      )}
      {error && <span className="text-body-sm text-error">{error}</span>}
    </div>
  );
}

/**
 * A small camera button for one section: captures just that section (the
 * element with `targetId`) as a picture — Photos / WhatsApp on a phone.
 */
export function SectionShot({ targetId, fileName }: { targetId: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const shot = async () => {
    const el = document.getElementById(targetId);
    if (!el) return;
    setBusy(true);
    try {
      const { dataUrl } = await capture(el, "png", "exporting-section");
      await saveFile(await (await fetch(dataUrl)).blob(), `${fileName}.png`, fileName);
    } catch (e) {
      console.error(e);
      alert("Couldn't create the picture. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        // The button sits in a section title, which would otherwise fold the section.
        e.preventDefault();
        e.stopPropagation();
        shot();
      }}
      disabled={busy}
      data-noexport
      title="Screenshot this section"
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-[12px] font-medium hover:bg-surface-container disabled:opacity-60 whitespace-nowrap"
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden>photo_camera</span>
      {busy ? "…" : "Screenshot"}
    </button>
  );
}
