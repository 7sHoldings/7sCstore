"use client";

import { useState, useTransition } from "react";
import { updateNotificationSettings, sendTestNotification } from "./actions";
import { Icon, Badge } from "@/components/ui";

export default function NotificationSettings({
  email,
  phone,
  emailEnabled,
  smsEnabled,
  emailProvider,
  smsProvider,
}: {
  email: string;
  phone: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  emailProvider: boolean;
  smsProvider: boolean;
}) {
  const [pending, start] = useTransition();
  const [testMsg, setTestMsg] = useState<string | null>(null);

  function test(channel: "email" | "sms") {
    setTestMsg(null);
    start(async () => {
      const r = await sendTestNotification(channel);
      setTestMsg(r.ok ? `Test ${channel} sent.` : `Could not send: ${r.reason}`);
    });
  }

  return (
    <div className="mt-6 pt-4 border-t border-outline-variant/60">
      <h4 className="text-label-caps uppercase text-on-surface-variant mb-3">Delivery channels</h4>

      <form action={updateNotificationSettings} className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-body-md text-on-surface">
            <Icon name="notifications" className="text-[18px] text-primary" /> In-app
          </span>
          <Badge tone="success">Always on</Badge>
        </div>

        <div>
          <label className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-2 text-body-md text-on-surface">
              <Icon name="mail" className="text-[18px] text-primary" /> Email
            </span>
            <Badge tone={emailProvider ? "success" : "neutral"}>{emailProvider ? "Provider ready" : "No provider"}</Badge>
          </label>
          <div className="flex gap-2">
            <input name="notifyEmail" type="email" defaultValue={email} placeholder="owner@example.com" className="ft-input py-1.5 text-body-sm flex-1" />
            <label className="flex items-center gap-1 text-body-sm">
              <input type="checkbox" name="emailEnabled" defaultChecked={emailEnabled} className="w-4 h-4 accent-[#0a2540]" /> On
            </label>
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-2 text-body-md text-on-surface">
              <Icon name="sms" className="text-[18px] text-primary" /> SMS
            </span>
            <Badge tone={smsProvider ? "success" : "neutral"}>{smsProvider ? "Provider ready" : "No provider"}</Badge>
          </label>
          <div className="flex gap-2">
            <input name="notifyPhone" type="tel" defaultValue={phone} placeholder="+15551234567" className="ft-input py-1.5 text-body-sm flex-1" />
            <label className="flex items-center gap-1 text-body-sm">
              <input type="checkbox" name="smsEnabled" defaultChecked={smsEnabled} className="w-4 h-4 accent-[#0a2540]" /> On
            </label>
          </div>
        </div>

        <button type="submit" className="ft-btn-primary w-full justify-center">
          <Icon name="save" className="text-[18px]" /> Save channels
        </button>
      </form>

      <div className="flex gap-2 mt-3">
        <button onClick={() => test("email")} disabled={pending} className="ft-btn-ghost text-body-sm">
          <Icon name="send" className="text-[16px]" /> Test email
        </button>
        <button onClick={() => test("sms")} disabled={pending} className="ft-btn-ghost text-body-sm">
          <Icon name="send" className="text-[16px]" /> Test SMS
        </button>
      </div>
      {testMsg && <p className="text-body-sm text-on-surface-variant mt-2">{testMsg}</p>}
    </div>
  );
}
