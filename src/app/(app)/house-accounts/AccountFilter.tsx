"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Dropdown to filter House Accounts to a single account (preserves other params). */
export default function AccountFilter({ accounts, value }: { accounts: string[]; value?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(v: string) {
    const next = new URLSearchParams(params.toString());
    if (v) next.set("account", v);
    else next.delete("account");
    router.push(`${pathname}?${next.toString()}`);
    router.refresh(); // bypass the client router cache so filtered data loads immediately
  }

  return (
    <select value={value ?? ""} onChange={(e) => select(e.target.value)} className="ft-input" aria-label="Account">
      <option value="">All accounts</option>
      {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}
