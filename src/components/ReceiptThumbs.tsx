import { Icon } from "./ui";

/**
 * Receipt thumbnails with an explicit download button. `urls` are signed view
 * URLs; the download link appends &download to force a save (for invoicing).
 */
export function ReceiptThumbs({ urls }: { urls: string[] }) {
  if (!urls || urls.length === 0) return <span className="text-on-surface-variant">—</span>;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {urls.map((u, k) => (
        <span key={k} className="inline-flex items-center gap-1 rounded-md border border-outline-variant/60 p-0.5 pr-1.5">
          <a href={u} target="_blank" rel="noreferrer" title="View receipt">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="receipt" className="w-9 h-9 object-cover rounded" />
          </a>
          <a href={`${u}&download`} title="Download receipt" className="text-primary hover:opacity-80">
            <Icon name="download" className="text-[18px]" />
          </a>
        </span>
      ))}
    </div>
  );
}
