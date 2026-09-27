import { createWaitlistService } from "@/server/modules/waitlist";
import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { cookies } from "next/headers";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const token = (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value ?? "";
    const application = await createWaitlistService().withdraw(token);
    return Response.json({ ok: true, status: application.status, traceId }, { status: 200, headers: { "cache-control": "no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
