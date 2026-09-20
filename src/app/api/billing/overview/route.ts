import { getBillingOverviewQuery } from "@/server/modules/billing";
import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspace_id");
    const overview = await getBillingOverviewQuery(workspaceId);
    return Response.json({ overview, traceId }, { headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

