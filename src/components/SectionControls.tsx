"use client";
import { useEffect } from "react";

/**
 * "Open all / Close all" for the folding summary sections, and makes the jump
 * tabs (#departments, #fuel …) open the section they point at.
 */
export default function SectionControls() {
  useEffect(() => {
    const openTarget = (hash: string) => {
      if (!hash || hash.length < 2) return;
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      const d = el?.closest("details") ?? (el instanceof HTMLDetailsElement ? el : null);
      if (d && !d.open) d.open = true;
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (a) openTarget(a.getAttribute("href") ?? "");
    };
    const onHash = () => openTarget(window.location.hash);
    openTarget(window.location.hash);
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const setAll = (open: boolean) =>
    document.querySelectorAll<HTMLDetailsElement>("details[data-section]").forEach((d) => (d.open = open));

  const btn =
    "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-body-sm font-medium hover:bg-surface-container";
  return (
    <div className="flex items-center gap-2" data-noexport>
      <button type="button" className={btn} onClick={() => setAll(true)}>
        <span className="material-symbols-outlined text-[18px]" aria-hidden>unfold_more</span> Open all
      </button>
      <button type="button" className={btn} onClick={() => setAll(false)}>
        <span className="material-symbols-outlined text-[18px]" aria-hidden>unfold_less</span> Close all
      </button>
    </div>
  );
}
