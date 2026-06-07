"use client";

import { useTransition } from "react";
import { Icon } from "./ui";

export default function LocationSwitcher({
  locations,
  activeId,
  onSwitch,
}: {
  locations: { id: string; name: string }[];
  activeId?: string;
  onSwitch: (id: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  if (locations.length <= 1) return null;

  return (
    <label className="flex items-center gap-1.5 bg-surface-container-low border border-outline-variant/60 rounded-md px-2 py-1.5">
      <Icon name="location_on" className="text-[18px] text-primary" />
      <select
        value={activeId ?? ""}
        disabled={pending}
        onChange={(e) => start(() => onSwitch(e.target.value))}
        className="bg-transparent text-body-sm font-medium text-on-surface focus:outline-none cursor-pointer max-w-[10rem]"
        aria-label="Active location"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
