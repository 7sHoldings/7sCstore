"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { catLabel } from "@/lib/format";

/**
 * Inventory filter bar. Department and Category apply immediately on change
 * (no separate "Search" click); the text box applies on Enter or the button.
 */
export default function InventoryFilters({
  q,
  cat,
  dept,
  departments,
  categories,
}: {
  q: string;
  cat: string;
  dept: string;
  departments: string[];
  categories: string[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const f = formRef.current;
    if (!f) return;
    const data = new FormData(f);
    const params = new URLSearchParams();
    for (const k of ["dept", "cat", "q"]) {
      const v = String(data.get(k) ?? "").trim();
      if (v) params.set(k, v);
    }
    router.push(`/inventory${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <form
      ref={formRef}
      className="flex gap-2 flex-wrap"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <select name="dept" defaultValue={dept} onChange={submit} className="ft-input h-9 w-44">
        <option value="">All departments</option>
        {departments.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select name="cat" defaultValue={cat} onChange={submit} className="ft-input h-9 w-40">
        <option value="">All categories</option>
        {categories.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
      </select>
      <input name="q" defaultValue={q} placeholder="Search name or UPC…" className="ft-input h-9 w-56" />
      <button className="ft-btn-secondary h-9">Search</button>
      {(q || cat || dept) && <a href="/inventory" className="ft-btn-ghost h-9 flex items-center px-3">Clear</a>}
    </form>
  );
}
