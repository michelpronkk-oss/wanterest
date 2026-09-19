import { getWorkspaceQuery } from "@/server/modules/workspaces";
import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId } = await context.params;
    const workspace = await getWorkspaceQuery(workspaceId);
    return Response.json({ workspace, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
