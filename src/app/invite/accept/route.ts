import { NextResponse } from "next/server";

import { waitlistAdmissionTokenSchema } from "@/server/modules/waitlist";
import { WAITLIST_ADMISSION_COOKIE, WAITLIST_ADMISSION_COOKIE_MAX_AGE } from "@/server/modules/waitlist/waitlist-admission.session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token") ?? "";
  if (!waitlistAdmissionTokenSchema.safeParse(token).success) return unavailable();

  const response = NextResponse.redirect(new URL("/invite/complete", requestUrl.origin), { status: 303 });
  response.cookies.set(WAITLIST_ADMISSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/invite",
    maxAge: WAITLIST_ADMISSION_COOKIE_MAX_AGE,
  });
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function unavailable() {
  return new NextResponse(
    "<!doctype html><title>Invitation unavailable</title><main><h1>That invitation is no longer available.</h1><p>Ask Wanterest for a new invitation.</p></main>",
    { status: 400, headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" } },
  );
}
