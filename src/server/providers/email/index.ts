import "server-only";

import { getServerEnv } from "@/server/lib/env";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./contracts";

class DisabledEmailProvider implements EmailProvider {
  async send(): Promise<EmailSendResult> {
    return { ok: false, code: "NOT_CONFIGURED", message: "Email delivery is not configured." };
  }
}

class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
      if (!response.ok) return { ok: false, code: "PROVIDER_FAILED", message: typeof body?.message === "string" ? body.message.slice(0, 300) : `Email provider returned ${response.status}.` };
      return { ok: true, providerMessageId: typeof body?.id === "string" ? body.id : null };
    } catch (error) {
      return { ok: false, code: "PROVIDER_FAILED", message: error instanceof Error ? error.message.slice(0, 300) : "Email provider request failed." };
    }
  }
}

export function getEmailProvider(): EmailProvider {
  const env = getServerEnv();
  return env.RESEND_API_KEY && env.RESEND_FROM_EMAIL
    ? new ResendEmailProvider(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL)
    : new DisabledEmailProvider();
}

export type { EmailMessage, EmailProvider, EmailSendResult } from "./contracts";
