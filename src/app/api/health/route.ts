import { getTraceId } from "@/server/lib/request-context";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  const checkedAt = new Date().toISOString();
  try {
    const { error } = await createSupabaseServiceClient().from("workspaces").select("id").limit(1);
    const ready = !error;
    return Response.json({ status: ready ? "ok" : "degraded", liveness: "ok", readiness: ready ? "ok" : "error", checkedAt, optionalProviders: { reddit: "non_blocking" }, traceId }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store", "x-request-id": traceId } });
  } catch {
    return Response.json({ status: "degraded", liveness: "ok", readiness: "error", checkedAt, optionalProviders: { reddit: "non_blocking" }, traceId }, { status: 503, headers: { "cache-control": "no-store", "x-request-id": traceId } });
  }
}
