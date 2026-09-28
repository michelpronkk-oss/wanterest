import { NextResponse } from "next/server";

import { AppError } from "@/server/lib/errors";
import { createWaitlistService } from "@/server/modules/waitlist";
import { waitlistStatusTokenSchema, waitlistVerificationTokenSchema } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE, WAITLIST_STATUS_COOKIE_MAX_AGE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

/** Design 05 — the identity reveal is the first screen after a successful verification. */
const VERIFIED_DESTINATION = "/waitlist/verified";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const statusToken = url.searchParams.get("status") ?? "";
  if (!waitlistVerificationTokenSchema.safeParse(token).success || !waitlistStatusTokenSchema.safeParse(statusToken).success) {
    return verificationFailure(url, "invalid");
  }
  try {
    // Idempotent: a link for an already-verified request returns the same row and number.
    await createWaitlistService().verify(token);
  } catch (error) {
    // The postgres reason ("...expired" vs "...invalid") only chooses between two static pages;
    // it is never echoed to the browser.
    const providerMessage = error instanceof AppError && typeof error.details?.providerMessage === "string" ? error.details.providerMessage : "";
    return verificationFailure(url, providerMessage.includes("expired") ? "expired" : "invalid");
  }
  const response = NextResponse.redirect(new URL(VERIFIED_DESTINATION, url.origin), { status: 303 });
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

/** Redirects away from the token-bearing URL so the tokens never sit in history or a referrer. */
function verificationFailure(url: URL, reason: "expired" | "invalid") {
  const response = NextResponse.redirect(new URL(`/waitlist/link-unavailable?reason=${reason}`, url.origin), { status: 303 });
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
