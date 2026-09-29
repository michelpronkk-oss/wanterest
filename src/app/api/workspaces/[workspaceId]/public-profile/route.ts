import { updateWorkspacePublicCohortProfileCommand, getWorkspacePublicCohortProfileQuery } from "@/server/modules/cohort-public";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId } = await context.params;
    const profile = await getWorkspacePublicCohortProfileQuery(workspaceId);
    return Response.json({ profile, traceId }, { headers: { "x-request-id": traceId, "cache-control": "private, no-store" } });
  } catch (error) {
    const response = jsonError(error, traceId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const traceId = getTraceId(request);
  try {
    const { workspaceId } = await context.params;
    const profile = await updateWorkspacePublicCohortProfileCommand(workspaceId, await readJson(request), traceId);
    return Response.json({ profile, traceId }, { headers: { "x-request-id": traceId, "cache-control": "private, no-store" } });
  } catch (error) {
    const response = jsonError(error, traceId);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
