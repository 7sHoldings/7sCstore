/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";

/** Receipt photo picker — camera or photo library on phones — with previews. */
export default function ReceiptInput({ existing = [] }: { existing?: string[] }) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div>
      <label className="ft-label mb-1 block">Receipt photos (camera or upload)</label>
      <input
        type="file"
        name="photos"
        accept="image/*"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="block w-full text-body-sm text-on-surface-variant file:mr-3 file:rounded-md file:border-0 file:bg-primary file:text-on-primary file:px-3 file:py-2 file:font-medium file:cursor-pointer"
      />
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <img key={i} src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-md border border-outline-variant/60" />
          ))}
        </div>
      )}
      {existing.length > 0 && (
        <div className="mt-3">
          <div className="text-label-caps uppercase text-on-surface-variant mb-1">Saved receipts</div>
          <div className="flex flex-wrap gap-2">
            {existing.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" title="Open receipt">
                <img src={u} alt="receipt" className="w-16 h-16 object-cover rounded-md border border-outline-variant/60 hover:shadow-floating transition-shadow" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
