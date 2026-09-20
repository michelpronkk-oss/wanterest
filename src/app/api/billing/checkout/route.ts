import { createCheckoutCommand } from "@/server/modules/billing";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const result = await createCheckoutCommand(await readJson(request));
    return Response.json({ ...result, traceId }, { status: 201, headers: { "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
