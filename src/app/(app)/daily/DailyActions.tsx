"use client";

import { Icon } from "@/components/ui";

/** Export (PDF/Excel) + print controls for the daily closing. */
export default function DailyActions({ query, canExport }: { query: string; canExport: boolean }) {
  return (
    <div className="flex items-center gap-2 no-print">
      {canExport && (
        <>
          <a href={`/api/export?type=daily_closing&${query}&format=pdf`} className="ft-btn-secondary py-1.5 px-3 text-body-sm">
            <Icon name="picture_as_pdf" className="text-[18px]" /> PDF
          </a>
          <a href={`/api/export?type=daily_closing&${query}&format=excel`} className="ft-btn-secondary py-1.5 px-3 text-body-sm">
            <Icon name="table_view" className="text-[18px]" /> Excel
          </a>
        </>
      )}
      <button onClick={() => window.print()} className="ft-btn-ghost py-1.5 px-3 text-body-sm">
        <Icon name="print" className="text-[18px]" /> Print
      </button>
    </div>
  );
}
