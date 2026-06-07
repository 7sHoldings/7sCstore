"use client";

import { useActionState } from "react";
import { setupAction } from "./actions";
import { Icon } from "@/components/ui";

export default function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, {});

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Icon name="local_gas_station" className="text-on-primary" />
          </div>
          <span className="text-headline-md font-bold text-primary">7sCstores</span>
        </div>

        <h1 className="text-headline-lg font-bold text-primary">Welcome — let's set up</h1>
        <p className="text-on-surface-variant mt-1 mb-6">
          Create your first location and owner account. You can add more later.
        </p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="ft-label" htmlFor="locationName">Location name</label>
            <input id="locationName" name="locationName" type="text" defaultValue="Henderson" className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="ownerName">Your name</label>
            <input id="ownerName" name="ownerName" type="text" defaultValue="Owner" className="ft-input" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" className="ft-input" placeholder="you@example.com" required />
          </div>
          <div>
            <label className="ft-label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" className="ft-input" placeholder="At least 8 characters" required />
          </div>

          {state?.error && (
            <div className="flex items-center gap-2 text-error text-body-sm bg-error-container/50 px-3 py-2 rounded-md">
              <Icon name="error" className="text-[18px]" /> {state.error}
            </div>
          )}

          <button type="submit" disabled={pending} className="ft-btn-primary w-full justify-center">
            {pending ? "Creating…" : "Create account & continue"}
            {!pending && <Icon name="arrow_forward" className="text-[18px]" />}
          </button>
        </form>
      </div>
    </div>
  );
}
