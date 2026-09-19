import {
  createWorkspaceCommand,
  listWorkspacesQuery,
} from "@/server/modules/workspaces";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  try {
    const workspaces = await listWorkspacesQuery();
    return Response.json({ workspaces, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const workspace = await createWorkspaceCommand(await readJson(request), request);
    return Response.json(
      { workspace, traceId },
      { status: 201, headers: { "x-request-id": traceId } },
    );
  } catch (error) {
    return jsonError(error, traceId);
  }
}
