import { createPortalSessionCommand } from "@/server/modules/billing";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const body = await readJson(request);
    const workspaceId = body && typeof body === "object" && "workspaceId" in body ? body.workspaceId : undefined;
    const result = await createPortalSessionCommand(workspaceId);
    return Response.json({ ...result, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
