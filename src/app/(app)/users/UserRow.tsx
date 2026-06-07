"use client";

import { useTransition } from "react";
import { toggleUserActive, changeUserRole } from "./actions";
import { Icon } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/rbac";

const ROLES = ["OWNER", "MANAGER", "ACCOUNTANT", "EMPLOYEE"] as const;

export default function UserRow({
  id,
  name,
  email,
  role,
  active,
  isSelf,
}: {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <tr className="hover:bg-surface-container-low/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-semibold text-body-sm">
            {name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <div className="font-medium text-on-surface">{name}{isSelf && <span className="text-on-surface-variant"> (you)</span>}</div>
            <div className="text-body-sm text-on-surface-variant">{email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <select
          value={role}
          disabled={isSelf || pending}
          onChange={(e) => start(() => changeUserRole(id, e.target.value))}
          className="ft-input py-1.5 text-body-sm w-auto"
        >
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        {active ? (
          <span className="inline-flex items-center gap-1 text-secondary text-body-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-secondary" /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-on-surface-variant text-body-sm">
            <span className="w-2 h-2 rounded-full bg-outline" /> Disabled
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          disabled={isSelf || pending}
          onClick={() => start(() => toggleUserActive(id))}
          className="ft-btn-ghost text-body-sm disabled:opacity-40"
          title={isSelf ? "You can't disable yourself" : ""}
        >
          <Icon name={active ? "block" : "check_circle"} className="text-[18px]" />
          {active ? "Disable" : "Enable"}
        </button>
      </td>
    </tr>
  );
}
