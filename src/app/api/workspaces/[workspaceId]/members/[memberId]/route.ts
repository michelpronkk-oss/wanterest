import {
  deactivateWorkspaceMemberCommand,
  updateWorkspaceMemberCommand,
} from "@/server/modules/workspaces";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

type RouteContext = { params: Promise<{ workspaceId: string; memberId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId, memberId } = await context.params;
    const member = await updateWorkspaceMemberCommand(
      workspaceId,
      memberId,
      await readJson(request),
      request,
    );
    return Response.json({ member, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId, memberId } = await context.params;
    const member = await deactivateWorkspaceMemberCommand(workspaceId, memberId, request);
    return Response.json({ member, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
