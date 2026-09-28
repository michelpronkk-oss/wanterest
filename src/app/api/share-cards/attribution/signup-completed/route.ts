import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/modules/auth";
import { recordShareCardAttributionEvent } from "@/server/modules/share-cards/share-card-attribution";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!await getCurrentUser()) return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  await recordShareCardAttributionEvent("signup_completed");
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
