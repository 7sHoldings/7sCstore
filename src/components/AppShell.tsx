"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./ui";
import { NAV_ITEMS } from "@/lib/nav";
import { can, type Role, ROLE_LABELS } from "@/lib/rbac";

export default function AppShell({
  children,
  role,
  name,
  email,
  logout,
}: {
  children: React.ReactNode;
  role: Role;
  name: string;
  email: string;
  logout: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = NAV_ITEMS.filter((i) => !i.perm || can(role, i.perm));
  const mobileItems = items.filter((i) => i.mobile).slice(0, 4);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen">
      {/* Top app bar */}
      <header className="fixed top-0 inset-x-0 z-40 h-16 bg-surface-container-lowest border-b border-outline-variant/60 flex items-center justify-between px-4 md:pl-72 no-print">
        <div className="flex items-center gap-2 md:hidden">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Icon name="local_gas_station" className="text-on-primary text-[20px]" />
          </div>
          <span className="font-bold text-primary">FuelTrack</span>
        </div>
        <div className="hidden md:block" />
        <div className="flex items-center gap-2">
          <Link href="/alerts" className="ft-btn-ghost p-2 rounded-full relative" aria-label="Alerts">
            <Icon name="notifications" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error rounded-full" />
          </Link>
          <div className="flex items-center gap-2 pl-2 border-l border-outline-variant/60">
            <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-semibold text-body-sm">
              {name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="text-body-sm font-semibold text-on-surface">{name}</div>
              <div className="text-body-sm text-on-surface-variant">{ROLE_LABELS[role]}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden md:flex flex-col w-72 bg-primary text-on-primary px-4 py-5 no-print">
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-on-primary/10 flex items-center justify-center">
            <Icon name="local_gas_station" className="text-on-primary" />
          </div>
          <div>
            <p className="font-bold text-body-lg">FuelTrack</p>
            <p className="text-label-caps uppercase text-on-primary-container">Reporting Suite</p>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-body-md ${
                isActive(item.href)
                  ? "bg-on-primary/15 font-semibold"
                  : "text-on-primary-container hover:bg-on-primary/10"
              }`}
            >
              <Icon name={item.icon} className="text-[20px]" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-on-primary/15 pt-3 mt-3">
          <div className="px-3 py-1 mb-1">
            <div className="text-body-sm font-semibold truncate">{email}</div>
            <div className="text-label-caps uppercase text-on-primary-container">{ROLE_LABELS[role]}</div>
          </div>
          <form action={logout}>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-on-primary-container hover:bg-on-primary/10 transition-colors text-body-md">
              <Icon name="logout" className="text-[20px]" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-50 md:hidden h-16 bg-surface-container-lowest border-t border-outline-variant/60 flex items-center justify-around px-2 no-print">
        {mobileItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-md min-w-[3.5rem] ${
              isActive(item.href) ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            <Icon name={item.icon} className="text-[22px]" filled={isActive(item.href)} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        ))}
        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 px-3 py-1 text-on-surface-variant min-w-[3.5rem]"
        >
          <Icon name="menu" className="text-[22px]" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {/* Mobile "more" sheet */}
      {open && (
        <div className="fixed inset-0 z-[60] md:hidden no-print" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-0 inset-x-0 bg-surface-container-lowest rounded-t-xl p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-4" />
            <div className="grid grid-cols-3 gap-3">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex flex-col items-center gap-1 p-3 rounded-lg bg-surface-container-low text-on-surface"
                >
                  <Icon name={item.icon} className="text-[24px] text-primary" />
                  <span className="text-body-sm text-center">{item.label}</span>
                </Link>
              ))}
            </div>
            <form action={logout} className="mt-4">
              <button className="ft-btn-secondary w-full justify-center">
                <Icon name="logout" className="text-[18px]" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="md:pl-72 pt-16 pb-24 md:pb-8 min-h-screen print-full">
        <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
