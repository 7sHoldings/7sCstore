"use client";

import { Icon } from "./ui";

/** Shared bottom-sheet / centered modal wrapper for entry forms. */
export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center no-print">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-container-lowest rounded-t-xl sm:rounded-xl shadow-floating w-full sm:max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="sticky top-0 bg-surface-container-lowest border-b border-outline-variant/60 px-5 py-4 flex items-center justify-between">
          <h3 className="font-semibold text-on-surface text-headline-sm">{title}</h3>
          <button onClick={onClose} className="ft-btn-ghost p-1.5 rounded-full">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
