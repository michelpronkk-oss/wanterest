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

const LOGO_MARK = `<svg viewBox="0 0 120 118" width="20" height="20" aria-hidden="true"><polyline points="10,32 34,102 60,40 86,102 110,32" fill="none" stroke="#111110" stroke-width="16" stroke-linejoin="miter" stroke-linecap="butt"/><polygon points="60,19 51,42 69,42" fill="#D7FF3D"/></svg>`;

function layout(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wanterest invitation</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Archivo:wght@800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
    :root{color-scheme:light;background:#f7f6f1;color:#111110;font-family:'Inter',ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f7f6f1}main{min-height:100vh;display:grid;place-items:center;padding:32px 20px}
    .card{width:min(100%,540px);border:1px solid rgba(17,17,16,.08);border-radius:18px;background:#fff;padding:clamp(32px,6vw,48px);box-shadow:0 30px 70px -40px rgba(17,17,16,.35)}
    .mark{display:flex;align-items:center;gap:9px;font-family:'Sora',sans-serif;font-weight:600;font-size:16px;letter-spacing:-.01em;margin-bottom:48px}
    .pill{display:inline-flex;align-items:center;gap:9px;margin-bottom:22px;padding:8px 16px;border-radius:20px;background:#111110}
    .pill-dot{width:6px;height:6px;border-radius:50%;background:#D7FF3D}
    .pill-text{font-size:11px;font-weight:700;letter-spacing:.18em;color:#F5F4EE}
    .card h1{font-family:'Archivo',sans-serif;font-weight:800;font-size:clamp(30px,6vw,42px);line-height:1.06;letter-spacing:-.03em;margin:0 0 14px}
    .card p{color:#4a4a43;line-height:1.6;margin:0 0 26px;font-size:15px}
    .actions{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px}
    .button{display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:#111110;color:#fff;padding:14px 20px;border-radius:10px;font:600 14px 'Inter',sans-serif;cursor:pointer;text-decoration:none;transition:background .15s ease}
    .button:hover{background:#26261f}
    .button.outline{background:transparent;border-color:rgba(17,17,16,.16);color:#111110}
    .button.outline:hover{background:#f9f8f4}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(17,17,16,.08);border:1px solid rgba(17,17,16,.08);border-radius:12px;overflow:hidden;margin:0 0 26px}
    .meta div{background:#fff;padding:14px 16px}
    .meta dt{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#8c8c82;margin:0}
    .meta dd{margin:6px 0 0;font-weight:600;font-size:14px}
    .note{font-size:12px;color:#a3a399;line-height:1.55;margin:0}
    .card.is-invite{border-width:1.5px;border-color:#111110}
    .cohort{margin:0 0 22px;padding:16px 18px;border:1px solid rgba(17,17,16,.06);border-radius:16px;background:#f9f8f4}
    .cohort-kicker{font-size:11px;font-weight:700;letter-spacing:.12em;color:#a3a399;margin-bottom:6px}
    .cohort strong{display:block;font-size:14px;margin-bottom:4px}
    .cohort p{margin:0;font-size:12.5px;color:#8c8c82}
    @media(max-width:480px){.meta{grid-template-columns:1fr}.mark{margin-bottom:36px}.actions{flex-direction:column}.button{width:100%}}
  </style></head><body><main>${content}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/**
 * Design 10. Invitation details (recipient, expiry, Early Access number) are shown on the private
 * status page, which can read them from the status record. They are not repeated here: this route
 * only holds the raw invite token, and the only token-keyed operation is the consuming accept —
 * a preview would need a read-only invite lookup that does not exist yet.
 */
function reviewHtml(signedInEmail: string | null) {
  const account = signedInEmail ? `<dl class="meta"><div><dt>Signed in as</dt><dd>${escapeHtml(signedInEmail)}</dd></div><div><dt>Access</dt><dd>Workspace invitation</dd></div></dl>` : "";
  const cohort = `<div class="cohort"><div class="cohort-kicker">COHORT</div><strong>Assigned when your workspace is created</strong><p>If a founding cohort is still open, you may join it. Preview only &mdash; an invite is not a cohort.</p></div>`;
  return layout(`<section class="card is-invite" aria-labelledby="invite-title"><div class="mark">${LOGO_MARK}<span>wanterest</span></div><div class="pill"><span class="pill-dot" aria-hidden="true"></span><span class="pill-text">INVITE READY</span></div><h1 id="invite-title">You&rsquo;re invited.</h1><p>Your Wanterest workspace is ready to be created. This is real product access, not the waitlist. It&rsquo;s linked to your signed-in account &mdash; continue only if this is the account you want to use.</p>${account}<form method="post" action="/invite/complete"><div class="actions"><button class="button" type="submit">Accept invitation →</button></div></form>${cohort}<p class="note">Your workspace and cohort identity are created by the authoritative admission service after you confirm.</p></section>`);
}

function admissionHtml(result: AdmissionResult) {
  const cohort = result.cohort === "founding_25" ? "Founding 25" : result.cohort === "early_100" ? "Early 100" : null;
  const identity = cohort && result.cohortNumber ? `${cohort} · #${String(result.cohortNumber).padStart(result.cohort === "founding_25" ? 2 : 3, "0")}` : null;
  return layout(`<section class="card" aria-labelledby="admission-title"><div class="mark">${LOGO_MARK}<span>wanterest</span></div><div class="pill"><span class="pill-dot" aria-hidden="true"></span><span class="pill-text">ADMISSION CONFIRMED</span></div><h1 id="admission-title">Welcome to Wanterest.</h1><p>Your invitation has been accepted and your workspace access is ready.</p>${identity ? `<dl class="meta"><div><dt>Cohort identity</dt><dd>${identity}</dd></div><div><dt>Onboarding</dt><dd>${result.onboardingStatus === "completed" ? "Complete" : "Ready to begin"}</dd></div></dl>` : ""}<div class="actions"><a class="button" href="/app">Open Wanterest →</a></div><p class="note">This confirmation reflects the admission service result. It does not expose your invite token.</p></section>`);
}

function unavailable(title: string, detail: string) {
  return new NextResponse(layout(`<section class="card" aria-labelledby="invite-error-title"><div class="mark">${LOGO_MARK}<span>wanterest</span></div><div class="pill"><span class="pill-dot" aria-hidden="true"></span><span class="pill-text">INVITATION</span></div><h1 id="invite-error-title">${title}</h1><p>${detail}</p><div class="actions"><a class="button outline" href="/">Return to Wanterest →</a></div></section>`), { status: 400, headers: privateHtmlHeaders() });
}
