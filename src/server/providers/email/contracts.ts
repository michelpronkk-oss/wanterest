export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; code: "NOT_CONFIGURED" | "PROVIDER_FAILED"; message: string };

export type EmailProvider = {
  send(message: EmailMessage): Promise<EmailSendResult>;
};
