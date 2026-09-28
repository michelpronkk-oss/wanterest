import { createWaitlistService } from "@/server/modules/waitlist";
import { createSupabaseWaitlistRepository } from "@/server/modules/waitlist/waitlist.repository";
import { getProductAccessPolicy } from "@/server/modules/access";
import { createSupabaseAccessModeRepository } from "@/server/modules/access/access-mode.repository";
import { SupabaseRateLimitStore } from "@/server/modules/operations/rate-limit";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SITE_ORIGIN } from "@/shared/config/site";

const MAX_BODY_BYTES = 16_000;

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." }, traceId }, { status: 403 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Request is too large." }, traceId }, { status: 422 });
    const client = createSupabaseServiceClient();
    const policy = await getProductAccessPolicy(createSupabaseAccessModeRepository(client));
    if (!policy.waitlistRequestsAllowed) {
      return Response.json({ error: { code: "CONFLICT", message: "Early Access requests are closed because Wanterest is open." }, traceId }, { status: 409, headers: { "cache-control": "no-store", "x-request-id": traceId } });
    }
    const service = createWaitlistService({
      repository: createSupabaseWaitlistRepository(client),
      rateLimitStore: new SupabaseRateLimitStore(client),
    });
    await service.submit(await readJson(request), SITE_ORIGIN);
    // Keep this response identical for new, duplicate, verified, and honeypot
    // submissions. The public boundary must not become an email-enumeration oracle.
    return Response.json({ ok: true, message: "received", traceId }, { status: 200, headers: { "cache-control": "no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

export async function GET() {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, { status: 405 });
}
