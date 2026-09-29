import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/modules/auth";
import { createWaitlistAdmissionService } from "@/server/modules/waitlist";
import { WAITLIST_ADMISSION_COOKIE } from "@/server/modules/waitlist/waitlist-admission.session";
import { getTraceId } from "@/server/lib/request-context";
import { admissionHtml, reviewHtml, unavailableHtml } from "./admission-html";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = (await cookies()).get(WAITLIST_ADMISSION_COOKIE)?.value;
  if (!token) return unavailable("This invitation is no longer available.", "Ask Wanterest for a new invitation.");

  const user = await getCurrentUser();
  if (!user) {
    const response = NextResponse.redirect(new URL("/login?next=/invite/complete", requestUrl.origin), { status: 303 });
    applyPrivateHeaders(response);
    return response;
  }

  return new NextResponse(reviewHtml(user.email ?? null), { status: 200, headers: privateHtmlHeaders() });
}

/** Admission is an explicit user action. The invite token remains HttpOnly and server-held. */
export async function POST(request: Request) {
  const token = (await cookies()).get(WAITLIST_ADMISSION_COOKIE)?.value;
  if (!token) return unavailable("This invitation is no longer available.", "Ask Wanterest for a new invitation.");

  const user = await getCurrentUser();
  if (!user) {
    const response = NextResponse.redirect(new URL("/login?next=/invite/complete", request.url), { status: 303 });
    applyPrivateHeaders(response);
    return response;
  }

  try {
    const result = await createWaitlistAdmissionService().acceptInvite(token, user.id, getTraceId(request));
    const response = new NextResponse(admissionHtml(result), { status: 200, headers: privateHtmlHeaders() });
    response.cookies.set(WAITLIST_ADMISSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/invite",
      maxAge: 0,
    });
    return response;
  } catch {
    return unavailable("This invitation could not be completed.", "It may be expired, revoked, already used, or linked to another account.");
  }
}

function privateHtmlHeaders(): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function applyPrivateHeaders(response: NextResponse) {
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
}

function unavailable(title: string, detail: string) {
  return new NextResponse(unavailableHtml(title, detail), { status: 400, headers: privateHtmlHeaders() });
}
