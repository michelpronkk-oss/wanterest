import { BillingProviderError } from "@/server/providers/billing/contracts";
import { receiveDodoWebhook } from "@/server/modules/billing";
import { AppError } from "@/server/lib/errors";
import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    // Signature verification requires the exact raw body before any JSON parsing.
    const rawBody = await request.text();
    const result = await receiveDodoWebhook(rawBody, {
      "webhook-id": request.headers.get("webhook-id") ?? undefined,
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? undefined,
      "webhook-signature": request.headers.get("webhook-signature") ?? undefined,
    });
    return Response.json({ accepted: true, duplicate: result.duplicate, eventId: result.eventId, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    if (error instanceof BillingProviderError) {
      const code = error.code === "UNAUTHORIZED" ? "FORBIDDEN" : error.code === "INVALID_REQUEST" ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      return jsonError(new AppError(code, error.message, code === "FORBIDDEN" ? 401 : undefined), traceId);
    }
    return jsonError(error, traceId);
  }
}

