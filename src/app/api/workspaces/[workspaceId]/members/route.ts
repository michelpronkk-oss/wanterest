import { addWorkspaceMemberCommand } from "@/server/modules/workspaces";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId } = await context.params;
    const member = await addWorkspaceMemberCommand(workspaceId, await readJson(request), request);
    return Response.json(
      { member, traceId },
      { status: 201, headers: { "x-request-id": traceId } },
    );
  } catch (error) {
    return jsonError(error, traceId);
  }
}
