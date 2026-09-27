import { createWaitlistService } from "@/server/modules/waitlist";
import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const body = await readJson(request);
    const token = typeof body === "object" && body !== null && "token" in body && typeof body.token === "string" ? body.token : "";
    const application = await createWaitlistService().withdraw(token);
    return Response.json({ ok: true, status: application.status, traceId }, { status: 200, headers: { "cache-control": "no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
