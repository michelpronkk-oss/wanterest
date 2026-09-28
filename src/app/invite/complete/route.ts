import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/server/modules/auth";
import { createWaitlistAdmissionService } from "@/server/modules/waitlist";
import { WAITLIST_ADMISSION_COOKIE } from "@/server/modules/waitlist/waitlist-admission.session";
import { getTraceId } from "@/server/lib/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const token = cookieStore.get(WAITLIST_ADMISSION_COOKIE)?.value;
  if (!token) return unavailable();

  const user = await getCurrentUser();
  if (!user) {
    const response = NextResponse.redirect(new URL("/login?next=/invite/complete", requestUrl.origin), { status: 303 });
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  }

  try {
    await createWaitlistAdmissionService().acceptInvite(token, user.id, getTraceId(request));
    const response = NextResponse.redirect(new URL("/app", requestUrl.origin), { status: 303 });
    response.cookies.set(WAITLIST_ADMISSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/invite", maxAge: 0 });
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return new NextResponse(
    "<!doctype html><title>Invitation unavailable</title><main><h1>This invitation could not be completed.</h1><p>It may be expired, revoked, already used, or linked to another account.</p></main>",
    { status: 400, headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" } },
  );
}
