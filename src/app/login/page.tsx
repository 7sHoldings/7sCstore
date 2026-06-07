"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Icon } from "@/components/ui";

const DEMO = [
  ["Owner / Admin", "owner@7scstore.com"],
  ["Manager", "manager@7scstore.com"],
  ["Accountant", "accountant@7scstore.com"],
  ["Employee", "employee@7scstore.com"],
];

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, {});

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="lg:w-1/2 bg-primary text-on-primary p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center gap-3 z-10">
          <div className="w-10 h-10 rounded-lg bg-on-primary/10 flex items-center justify-center">
            <Icon name="local_gas_station" className="text-on-primary" />
          </div>
          <span className="text-headline-md font-bold">7sCstore</span>
        </div>
        <div className="z-10 max-w-md">
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight">
            Know your station's profit — every day.
          </h1>
          <p className="mt-4 text-on-primary-container text-body-lg">
            Sales, fuel margins, expenses, and net profit in one place. Daily,
            weekly, monthly, and yearly.
          </p>
        </div>
        <p className="z-10 text-on-primary-container text-body-sm">
          Phase 1 · Manual &amp; Excel entry · POS integration ready
        </p>
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-on-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-10 w-80 h-80 bg-on-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Form panel */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 lg:p-14">
        <div className="w-full max-w-sm">
          <h2 className="text-headline-lg font-bold text-primary">Sign in</h2>
          <p className="text-on-surface-variant mt-1 mb-6">
            Welcome back. Enter your credentials to continue.
          </p>

          <form action={formAction} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue="owner@7scstore.com"
                className="ft-input"
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                defaultValue="password123"
                className="ft-input"
                placeholder="••••••••"
              />
            </Field>

            {state?.error && (
              <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
                <Icon name="error" className="text-[18px]" />
                {state.error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="ft-btn-primary w-full justify-center"
            >
              {pending ? "Signing in…" : "Sign in"}
              {!pending && <Icon name="arrow_forward" className="text-[18px]" />}
            </button>
          </form>

          <div className="mt-8 border-t border-outline-variant/60 pt-4">
            <p className="text-label-caps uppercase text-on-surface-variant mb-2">
              Demo accounts · password123
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map(([role, email]) => (
                <div
                  key={email}
                  className="text-body-sm bg-surface-container-low rounded-md px-2.5 py-1.5"
                >
                  <div className="font-semibold text-on-surface">{role}</div>
                  <div className="text-on-surface-variant truncate">{email}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-body-sm font-semibold text-on-surface mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
