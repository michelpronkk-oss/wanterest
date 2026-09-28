import { cookies } from "next/headers";

import { jsonError } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { createWaitlistService } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

/**
 * Same operation as /api/waitlist/withdraw, mounted under /waitlist because the private status
 * cookie is scoped to path=/waitlist — browsers never send it to /api/*, so withdrawal from the
 * status page could not reach the service. Widening the cookie's path was deliberately avoided.
 */
export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." }, traceId }, { status: 403 });
  }
  try {
    const token = (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value ?? "";
    const application = await createWaitlistService().withdraw(token);
    return Response.json({ ok: true, status: application.status, traceId }, { status: 200, headers: { "cache-control": "no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
