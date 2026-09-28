import { NextResponse } from "next/server";

import { AppError } from "@/server/lib/errors";
import { createWaitlistService } from "@/server/modules/waitlist";
import { waitlistStatusTokenSchema, waitlistVerificationTokenSchema } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE, WAITLIST_STATUS_COOKIE_MAX_AGE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const statusToken = url.searchParams.get("status") ?? "";
  if (!waitlistVerificationTokenSchema.safeParse(token).success || !waitlistStatusTokenSchema.safeParse(statusToken).success) {
    return verificationFailure(false);
  }
  try {
    await createWaitlistService().verify(token);
  } catch (error) {
    // The postgres reason ("...expired" vs "...invalid") never leaves this server-rendered
    // response as data — it only picks which of two safe, static HTML strings to send.
    const providerMessage = error instanceof AppError && typeof error.details?.providerMessage === "string" ? error.details.providerMessage : "";
    return verificationFailure(providerMessage.includes("expired"));
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

function verificationFailure(expired: boolean) {
  const title = expired ? "This link has expired" : "That link is no longer available";
  const detail = expired ? "Confirmation links last 48 hours. Request a new one from the Early Access form." : "Request a new verification email from the Early Access form.";
  return new NextResponse(
    `<!doctype html><title>Verification unavailable</title><main><h1>${title}.</h1><p>${detail}</p><a href="/waitlist">Back to Early Access</a></main>`,
    { status: 400, headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" } },
  );
}
