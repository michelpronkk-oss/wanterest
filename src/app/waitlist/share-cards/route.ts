import { cookies } from "next/headers";

import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { getApplicantShareCardsQuery, mutateApplicantShareCardCommand } from "@/server/modules/share-cards";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

/**
 * Applicant share cards (Layer 13B.1), mounted under /waitlist so the path=/waitlist status cookie
 * actually reaches it. Same commands and authority as /api/share-cards/applicant — no second engine.
 * Response shape matches ShareCardPanel's contract: `card` after publish, `cards` after revoke.
 */
async function statusToken(): Promise<string> {
  return (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value ?? "";
}

const privateHeaders = (traceId: string) => ({ "cache-control": "private, no-store", "x-request-id": traceId });

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  try {
    const cards = await getApplicantShareCardsQuery(await statusToken());
    return Response.json({ cards, traceId }, { headers: privateHeaders(traceId) });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." }, traceId }, { status: 403 });
  }
  try {
    const result = await mutateApplicantShareCardCommand(await statusToken(), await readJson(request));
    const body = Array.isArray(result) ? { cards: result, traceId } : { card: result, traceId };
    return Response.json(body, { headers: privateHeaders(traceId) });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
