import { requireUser } from "@/server/modules/auth";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import {
  getWorkspaceShareCardsQuery,
  mutateWorkspaceShareCardCommand,
} from "@/server/modules/share-cards";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId } = await context.params;
    const user = await requireUser();
    const cards = await getWorkspaceShareCardsQuery(workspaceId, user.id);
    return Response.json({ cards, traceId }, { headers: { "cache-control": "private, no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId } = await context.params;
    const user = await requireUser();
    const result = await mutateWorkspaceShareCardCommand(workspaceId, user.id, await readJson(request));
    // Publish returns the one card; unpublish returns the refreshed list.
    return Response.json({ ...(Array.isArray(result) ? { cards: result } : { card: result }), traceId }, { headers: { "cache-control": "private, no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
