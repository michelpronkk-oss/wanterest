import { cookies } from "next/headers";

import { jsonError, readJson } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import {
  getApplicantShareCardsQuery,
  mutateApplicantShareCardCommand,
} from "@/server/modules/share-cards";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

async function statusToken(): Promise<string> {
  return (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value ?? "";
}

export async function GET(request: Request) {
  const traceId = getTraceId(request);
  try {
    const cards = await getApplicantShareCardsQuery(await statusToken());
    return Response.json({ cards, traceId }, { headers: { "cache-control": "private, no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  try {
    const card = await mutateApplicantShareCardCommand(await statusToken(), await readJson(request));
    return Response.json({ card, traceId }, { headers: { "cache-control": "private, no-store", "x-request-id": traceId } });
  } catch (error) {
    return jsonError(error, traceId);
  }
}
