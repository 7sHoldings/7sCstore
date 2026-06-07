"use client";

import { useTransition } from "react";
import { Icon } from "./ui";

/** Confirm-then-delete button wired to a server action (FR-45 editDelete). */
export default function DeleteButton({
  id,
  action,
  label = "Delete this record?",
}: {
  id: string;
  action: (id: string) => Promise<void>;
  label?: string;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm(label)) start(() => action(id));
      }}
      className="text-on-surface-variant hover:text-error transition-colors p-1.5 rounded-md disabled:opacity-50"
      aria-label="Delete"
    >
      <Icon name={pending ? "hourglass_empty" : "delete"} className="text-[18px]" />
    </button>
  );
}
