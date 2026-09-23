import { revalidatePath } from "next/cache";

import { BillingProviderError } from "@/server/providers/billing/contracts";
import { receiveDodoWebhook } from "@/server/modules/billing";
import { AppError } from "@/server/lib/errors";
import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    // Dodo's Standard Webhooks signature covers the exact raw body.
    const rawBody = await request.text();
    const result = await receiveDodoWebhook(rawBody, {
      "webhook-id": request.headers.get("webhook-id") ?? undefined,
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? undefined,
      "webhook-signature": request.headers.get("webhook-signature") ?? undefined,
    }, traceId);
    // Billing state is persisted by the webhook processor; invalidate only
    // the dashboard tree so the next navigation reflects the new entitlements.
    revalidatePath("/app", "layout");
    revalidatePath("/app/settings/billing");
    return Response.json({ accepted: true, duplicate: result.duplicate, eventId: result.eventId, processing: result.processing.status, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    if (error instanceof BillingProviderError) {
      const code = error.code === "UNAUTHORIZED" ? "FORBIDDEN" : error.code === "INVALID_REQUEST" ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      return jsonError(new AppError(code, error.message, code === "FORBIDDEN" ? 401 : undefined), traceId);
    }
    return jsonError(error, traceId);
  }
}
