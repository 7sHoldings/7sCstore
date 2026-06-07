/**
 * Notification dispatch (Phase 2). Every alert is always written in-app; email
 * and SMS are sent additionally when (a) the owner has enabled that channel and
 * set a recipient, and (b) the provider credentials exist in the environment.
 * With no provider configured the channel is a no-op, so this is safe to call
 * everywhere.
 */
import "server-only";
import { prisma } from "./db";
import { getSettings } from "./settings";

export type Channel = "email" | "sms";

interface DispatchInput {
  type: string;
  severity: "info" | "warning" | "error";
  message: string;
  locationId?: string | null;
}

/** Send an email via Resend if RESEND_API_KEY is configured. */
async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM || "alerts@7scstore.com";
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
    return res.ok;
  } catch (e) {
    console.error("email send failed", e);
    return false;
  }
}

/** Send an SMS via Twilio if account credentials are configured. */
async function sendSMS(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    return res.ok;
  } catch (e) {
    console.error("sms send failed", e);
    return false;
  }
}

export interface ProviderStatus {
  emailProvider: boolean;
  smsProvider: boolean;
}

export function providerStatus(): ProviderStatus {
  return {
    emailProvider: Boolean(process.env.RESEND_API_KEY),
    smsProvider: Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    ),
  };
}

/**
 * Persist an in-app alert and fan out to enabled channels. Returns which
 * channels actually delivered.
 */
export async function dispatchAlert(input: DispatchInput): Promise<{ email: boolean; sms: boolean }> {
  await prisma.alert.create({
    data: {
      locationId: input.locationId ?? null,
      type: input.type,
      severity: input.severity,
      message: input.message,
    },
  });

  const cfg = await getSettings(["emailEnabled", "smsEnabled", "notifyEmail", "notifyPhone"]);
  const subject = `7sCstore alert: ${input.type.replace(/_/g, " ").toLowerCase()}`;

  let email = false;
  let sms = false;
  if (cfg.emailEnabled === "true" && cfg.notifyEmail) {
    email = await sendEmail(cfg.notifyEmail, subject, input.message);
  }
  if (cfg.smsEnabled === "true" && cfg.notifyPhone) {
    sms = await sendSMS(cfg.notifyPhone, input.message);
  }
  return { email, sms };
}

/** Send a one-off test message on a channel (used by the settings UI). */
export async function sendTest(channel: Channel): Promise<{ ok: boolean; reason?: string }> {
  const cfg = await getSettings(["notifyEmail", "notifyPhone"]);
  if (channel === "email") {
    if (!process.env.RESEND_API_KEY) return { ok: false, reason: "No email provider configured (RESEND_API_KEY)." };
    if (!cfg.notifyEmail) return { ok: false, reason: "No recipient email set." };
    const ok = await sendEmail(cfg.notifyEmail, "7sCstore test alert", "This is a test notification from 7sCstore.");
    return { ok, reason: ok ? undefined : "Provider rejected the message." };
  }
  if (!providerStatus().smsProvider) return { ok: false, reason: "No SMS provider configured (Twilio)." };
  if (!cfg.notifyPhone) return { ok: false, reason: "No recipient phone set." };
  const ok = await sendSMS(cfg.notifyPhone, "7sCstore test alert: this is a test notification.");
  return { ok, reason: ok ? undefined : "Provider rejected the message." };
}
