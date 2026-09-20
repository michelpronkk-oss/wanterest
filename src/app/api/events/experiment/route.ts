import { ExperimentService, SupabaseExperimentRepository } from "@/server/modules/experiments";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { enforceRateLimit, SupabaseRateLimitStore } from "@/server/modules/operations";
import { getTraceId } from "@/server/lib/request-context";
import { jsonError, readJson } from "@/server/lib/http";

function service() {
  const client = createSupabaseServiceClient();
  const repository = new SupabaseExperimentRepository(client);
  return { service: new ExperimentService({ repository, actions: { getAction: async () => null } }), rateLimit: new SupabaseRateLimitStore(client) };
}

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (token.length > 240) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid experiment token." }, traceId }, { status: 422, headers: { "x-request-id": traceId } });
    const { service: experimentService } = service();
    const experiment = await experimentService.getActivePublicExperiment(token);
    return Response.json({ experiment, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) { return jsonError(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Event payload is too large." }, traceId }, { status: 422, headers: { "x-request-id": traceId } });
    const body = await readJson(request);
    const publicToken = body && typeof body === "object" && "publicToken" in body && typeof body.publicToken === "string" ? body.publicToken : "";
    const { service: experimentService, rateLimit } = service();
    await enforceRateLimit(rateLimit, `experiment-event:${publicToken.slice(0, 240)}`, 120, 60_000);
    const event = await experimentService.recordPublicEvent(body);
    return Response.json({ eventId: event.id, accepted: true, traceId }, { status: 202, headers: { "x-request-id": traceId } });
  } catch (error) { return jsonError(error, traceId); }
}
