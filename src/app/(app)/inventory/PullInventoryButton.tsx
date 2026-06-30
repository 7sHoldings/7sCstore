"use client";

import { useState, useTransition } from "react";
import { pullInventoryFromModisoft } from "./actions";
import { Icon } from "@/components/ui";

export default function PullInventoryButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      const r = await pullInventoryFromModisoft();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." });
    });
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`text-body-sm flex items-center gap-1 ${msg.ok ? "text-secondary" : "text-error"}`}>
          <Icon name={msg.ok ? "check_circle" : "error"} className="text-[18px]" /> {msg.text}
        </span>
      )}
      <button onClick={run} disabled={pending} className="ft-btn-secondary">
        <Icon name={pending ? "sync" : "cloud_download"} className={`text-[18px] ${pending ? "animate-spin" : ""}`} />
        {pending ? "Pulling…" : "Pull from Modisoft"}
      </button>
    </div>
  );
}
