import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/modules/auth";
import { createWaitlistAdmissionService, type AdmissionResult } from "@/server/modules/waitlist";
import { WAITLIST_ADMISSION_COOKIE } from "@/server/modules/waitlist/waitlist-admission.session";
import { getTraceId } from "@/server/lib/request-context";

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

  return new NextResponse(reviewHtml(), { status: 200, headers: privateHtmlHeaders() });
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

function layout(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wanterest invitation</title><style>
    :root{color-scheme:light;background:#f7f6f1;color:#111110;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f7f6f1}main{min-height:100vh;display:grid;place-items:center;padding:32px 20px}.card{width:min(100%,560px);border:1px solid rgba(17,17,16,.14);background:#fffefa;padding:clamp(28px,6vw,56px);box-shadow:0 24px 80px rgba(17,17,16,.08)}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;color:#74746c}.mark{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.02em;margin-bottom:56px}.mark-dot{width:20px;height:20px;background:#111110;display:inline-grid;place-items:center;color:#d7ff3d;font-size:12px}.card h1{font-family:ui-sans-serif,system-ui,sans-serif;font-size:clamp(32px,7vw,54px);line-height:1.02;letter-spacing:-.05em;margin:14px 0 18px}.card p{color:#66665f;line-height:1.6;margin:0 0 28px}.button{display:inline-flex;align-items:center;justify-content:center;border:0;background:#111110;color:#fff;padding:14px 20px;border-radius:8px;font:600 14px ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-decoration:none}.button.accent{background:#d7ff3d;color:#111110}.meta{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(17,17,16,.12);border:1px solid rgba(17,17,16,.12);margin:28px 0}.meta div{background:#fffefa;padding:14px}.meta dt{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#8c8c82}.meta dd{margin:6px 0 0;font-weight:600}.note{font-size:12px;color:#8c8c82;margin-top:18px!important;margin-bottom:0!important}@media(max-width:520px){.meta{grid-template-columns:1fr}.mark{margin-bottom:40px}}
  </style></head><body><main>${content}</main></body></html>`;
}

function reviewHtml() {
  return layout(`<section class="card" aria-labelledby="invite-title"><div class="mark"><span class="mark-dot" aria-hidden="true">W</span><span>wanterest</span></div><div class="eyebrow">INVITATION READY</div><h1 id="invite-title">Your access is ready to accept.</h1><p>This invitation is linked to your signed-in account. Continue only if this is the account you want to use for Wanterest.</p><form method="post" action="/invite/complete"><button class="button accent" type="submit">Accept invitation →</button></form><p class="note">Your workspace and cohort identity are created by the authoritative admission service after you confirm.</p></section>`);
}

function admissionHtml(result: AdmissionResult) {
  const cohort = result.cohort === "founding_25" ? "Founding 25" : result.cohort === "early_100" ? "Early 100" : null;
  const identity = cohort && result.cohortNumber ? `${cohort} · #${String(result.cohortNumber).padStart(result.cohort === "founding_25" ? 2 : 3, "0")}` : null;
  return layout(`<section class="card" aria-labelledby="admission-title"><div class="mark"><span class="mark-dot" aria-hidden="true">W</span><span>wanterest</span></div><div class="eyebrow">ADMISSION CONFIRMED</div><h1 id="admission-title">Welcome to Wanterest.</h1><p>Your invitation has been accepted and your workspace access is ready.</p>${identity ? `<dl class="meta"><div><dt>Cohort identity</dt><dd>${identity}</dd></div><div><dt>Onboarding</dt><dd>${result.onboardingStatus === "completed" ? "Complete" : "Ready to begin"}</dd></div></dl>` : ""}<a class="button" href="/app">Open Wanterest →</a><p class="note">This confirmation reflects the admission service result. It does not expose your invite token.</p></section>`);
}

function unavailable(title: string, detail: string) {
  return new NextResponse(layout(`<section class="card" aria-labelledby="invite-error-title"><div class="mark"><span class="mark-dot" aria-hidden="true">W</span><span>wanterest</span></div><div class="eyebrow">INVITATION</div><h1 id="invite-error-title">${title}</h1><p>${detail}</p><a class="button" href="/">Return to Wanterest →</a></section>`), { status: 400, headers: privateHtmlHeaders() });
}
