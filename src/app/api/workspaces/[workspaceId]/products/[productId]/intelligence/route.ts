import { getTraceId } from "@/server/lib/request-context";
import { jsonError } from "@/server/lib/http";
import { readProductIntelligenceCommand } from "@/server/modules/operations/read-first-intelligence.command";

type RouteContext = { params: Promise<{ workspaceId: string; productId: string }> };

/** Read-only persisted product intelligence. No provider or qualification work runs here. */
export async function GET(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId, productId } = await context.params;
    const intelligence = await readProductIntelligenceCommand(workspaceId, productId);
    return Response.json({ ...intelligence, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

/**
 * Read-first refresh entry point. It returns the persisted snapshot plus the
 * existing async scan handle after dispatch and never waits for scan stages.
 */
export async function POST(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId, productId } = await context.params;
    const intelligence = await readProductIntelligenceCommand(workspaceId, productId, { enqueueRefresh: true });
    return Response.json({ ...intelligence, traceId }, { status: 202, headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
