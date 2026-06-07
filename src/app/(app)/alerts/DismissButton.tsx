"use client";

import { useTransition } from "react";
import { markAlertRead } from "./actions";
import { Icon } from "@/components/ui";

export default function DismissButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => markAlertRead(id))}
      className="ft-btn-ghost p-1.5 rounded-full flex-shrink-0"
      aria-label="Dismiss"
    >
      <Icon name={pending ? "hourglass_empty" : "close"} className="text-[18px]" />
    </button>
  );
}
