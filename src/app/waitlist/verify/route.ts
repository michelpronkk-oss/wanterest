import { NextResponse } from "next/server";

import { createWaitlistService } from "@/server/modules/waitlist";
import { waitlistStatusTokenSchema, waitlistVerificationTokenSchema } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE, WAITLIST_STATUS_COOKIE_MAX_AGE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const statusToken = url.searchParams.get("status") ?? "";
  if (!waitlistVerificationTokenSchema.safeParse(token).success || !waitlistStatusTokenSchema.safeParse(statusToken).success) {
    return verificationFailure();
  }
  try {
    await createWaitlistService().verify(token);
  } catch {
    return verificationFailure();
  }
  const response = NextResponse.redirect(new URL("/waitlist/status", url.origin), { status: 303 });
  response.cookies.set(WAITLIST_STATUS_COOKIE, statusToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/waitlist",
    maxAge: WAITLIST_STATUS_COOKIE_MAX_AGE,
  });
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function verificationFailure() {
  return new NextResponse(
    "<!doctype html><title>Verification unavailable</title><main><h1>That link is no longer available.</h1><p>Request a new verification email from the Early Access form.</p><a href=\"/waitlist\">Back to Early Access</a></main>",
    { status: 400, headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" } },
  );
}
