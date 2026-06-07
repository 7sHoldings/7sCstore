"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

/** Custom from/to range selector. Navigates to {path}?from=…&to=…. */
export default function RangePicker({ from, to, path = "/dashboard" }: { from?: string; to?: string; path?: string }) {
  const router = useRouter();
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");

  function apply() {
    if (!f || !t) return;
    router.push(`${path}?from=${f}&to=${t}`);
  }
  function thisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    router.push(`${path}?from=${start}&to=${end}`);
  }

  return (
    <div className="inline-flex items-center gap-2 bg-surface-container-low border border-outline-variant/60 rounded-md px-2 py-1">
      <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="From" />
      <span className="text-on-surface-variant">→</span>
      <input type="date" value={t} onChange={(e) => setT(e.target.value)} className="bg-transparent text-body-sm focus:outline-none" aria-label="To" />
      <button onClick={apply} disabled={!f || !t} className="ft-btn-primary py-1 px-2.5 text-body-sm disabled:opacity-50">
        <Icon name="search" className="text-[16px]" /> Apply
      </button>
      <button onClick={thisMonth} className="ft-btn-ghost py-1 px-2 text-body-sm" title="This month to date">Month</button>
    </div>
  );
}
