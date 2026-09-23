import { z } from "zod";

import { AppError } from "@/server/lib/errors";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { getEmailProvider } from "@/server/providers/email";
import { SUPPORT_EMAIL } from "@/shared/config/site";

const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  topic: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(4000),
});

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Public contact-form submission. Reuses the same Resend-backed email provider
 * already used for monitoring digests/alerts — no separate backend. */
export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const parsed = contactInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Please fill in every field with a valid value.", 422);
    const { name, email, topic, message } = parsed.data;

    const result = await getEmailProvider().send({
      to: SUPPORT_EMAIL,
      subject: `[Contact] ${topic} — ${name}`,
      text: `From: ${name} <${email}>\nTopic: ${topic}\n\n${message}`,
      html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p><strong>Topic:</strong> ${escapeHtml(topic)}</p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
    });
    if (!result.ok) {
      // Logged with real status by jsonError below; the client falls back to a
      // mailto: handoff so the message still reaches support either way.
      throw new AppError("INTERNAL_ERROR", `Contact email delivery failed: ${result.code}`);
    }

    return Response.json({ ok: true, traceId }, { status: 200, headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
