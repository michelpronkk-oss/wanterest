import { NextResponse } from "next/server";

import { getPublicShareCardQuery, recordShareCardEventCommand } from "@/server/modules/share-cards";
import { createShareCardAttributionToken, SHARE_CARD_ATTRIBUTION_COOKIE, SHARE_CARD_ATTRIBUTION_TTL_SECONDS } from "@/server/modules/share-cards/share-card-attribution";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const publicSlug = requestUrl.searchParams.get("slug") ?? "";
  const card = await getPublicShareCardQuery(publicSlug).catch(() => null);
  const token = card ? createShareCardAttributionToken(card.publicSlug) : null;
  if (!card || !token) return new Response("Share destination unavailable.", { status: 404, headers: { "cache-control": "no-store" } });

  const destination = new URL(card.ctaHref, requestUrl.origin);
  if (destination.origin !== requestUrl.origin) return new Response("Share destination unavailable.", { status: 404, headers: { "cache-control": "no-store" } });

  if (destination.pathname === "/signup") {
    await recordShareCardEventCommand({ publicSlug: card.publicSlug, eventType: "signup_started", source: "cta" }).catch(() => undefined);
  }

  const response = NextResponse.redirect(destination);
  response.cookies.set({
    name: SHARE_CARD_ATTRIBUTION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SHARE_CARD_ATTRIBUTION_TTL_SECONDS,
    ...(requestUrl.hostname === "wanterest.com" || requestUrl.hostname.endsWith(".wanterest.com") ? { domain: ".wanterest.com" } : {}),
  });
  return response;
}
