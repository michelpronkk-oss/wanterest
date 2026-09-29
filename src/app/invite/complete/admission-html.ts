import type { AdmissionResult } from "@/server/modules/waitlist";
import { apexSvgMarkup, wanterestLogoSvgMarkup } from "@/shared/apex-artwork";
import { admittedCohortPresentation } from "@/shared/member-presentation";

/*
 * Server-rendered HTML for /invite/complete. Pure string builders: no React,
 * client component or hook. Kept apart from route.ts so the exact markup can be
 * rendered from labeled fixtures and tested without executing an admission.
 */

// The approved master logo (unchanged geometry) and Apex 2.0 artwork come from the same
// pure string builders the React artwork uses; no client component or hook enters this HTML.
const LOGO_MARK = wanterestLogoSvgMarkup({ size: 20 });

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
    .status{display:inline-flex;align-self:flex-start;width:fit-content;align-items:center;gap:7px;height:24px;margin-bottom:22px;padding:0 9px;border-radius:6px;background:#F0EFE9;color:#4a4a43;font-size:11.5px;font-weight:600;white-space:nowrap}
    .status i{width:7px;height:7px;border-radius:2px;background:#111110}
    .status.is-invite{background:#111110;color:#F5F4EE}.status.is-invite i{background:#D7FF3D}
    .stack{width:min(100%,540px)}
    .brand{display:flex;align-items:center;gap:9px;margin:0 0 18px;font-family:'Sora',sans-serif;font-weight:600;font-size:16px;letter-spacing:-.01em}
    .reveal{display:flex;flex-direction:column;gap:14px;min-height:330px}
    .reveal.is-founding{background:#111110;color:#F5F4EE;border-color:#111110}
    .reveal-label{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:700;letter-spacing:.14em;white-space:nowrap}
    .reveal h1{margin:auto 0 0}
    .serial{display:flex;align-items:baseline;gap:4px;font-family:'Archivo',sans-serif;font-weight:800;font-variant-numeric:tabular-nums;line-height:.8}
    .serial b{font-weight:800;font-size:64px;letter-spacing:-.045em}.serial span{font-weight:700;font-size:15px;letter-spacing:-.02em;color:#8c8c82}
    .reveal.is-early .serial b{font-size:52px}.reveal.is-early .serial span{font-size:12px}
    .reveal.is-founding .serial span,.reveal.is-founding p,.reveal.is-founding .note{color:#9c9c92}
    .reveal p{margin:0}
    .reveal.is-founding .button{background:#F5F4EE;color:#111110}.reveal.is-founding .button:hover{background:#fff}
    .reveal .meta{margin:4px 0 0}.reveal.is-founding .meta{background:rgba(245,244,238,.14);border-color:rgba(245,244,238,.14)}.reveal.is-founding .meta div{background:#111110}.reveal.is-founding .meta dd{color:#F5F4EE}
    .button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
    @media (prefers-reduced-motion:no-preference){
      .stage{animation:rise 240ms cubic-bezier(.2,0,0,1) both}
      .reveal.is-founding .key polygon:last-child{animation:fade 240ms cubic-bezier(.2,0,0,1) 120ms both}
      .reveal.is-founding .key polygon:first-child{animation:fade 240ms cubic-bezier(.2,0,0,1) 360ms both}
      .reveal.is-founding .s1{animation-delay:640ms}.reveal.is-founding .s2{animation-delay:900ms}.reveal.is-founding .s3{animation-delay:1200ms}
      .reveal.is-early .key{animation:fade 240ms cubic-bezier(.2,0,0,1) 200ms both}
      .reveal.is-early .s1{animation-delay:520ms}.reveal.is-early .s2{animation-delay:520ms}.reveal.is-early .s3{animation-delay:800ms}
    }
    @media (prefers-reduced-motion:reduce){.reveal{animation:fade 200ms linear both}}
    @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    @keyframes fade{from{opacity:0}to{opacity:1}}
    @media(max-width:480px){.meta{grid-template-columns:1fr}.mark{margin-bottom:36px}.actions{flex-direction:column}.button{width:100%}.serial b{font-size:56px}}
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
export function reviewHtml(signedInEmail: string | null) {
  const account = signedInEmail ? `<dl class="meta"><div><dt>Signed in as</dt><dd>${escapeHtml(signedInEmail)}</dd></div><div><dt>Access</dt><dd>Workspace invitation</dd></div></dl>` : "";
  const cohort = `<div class="cohort"><div class="cohort-kicker">COHORT</div><strong>Assigned when your workspace is created</strong><p>If a founding cohort is still open, you may join it. Preview only &mdash; an invite is not a cohort.</p></div>`;
  return layout(`<section class="card is-invite" aria-labelledby="invite-title"><div class="mark">${LOGO_MARK}<span>wanterest</span></div><div class="status is-invite"><i aria-hidden="true"></i>Invitation ready</div><h1 id="invite-title">You&rsquo;re invited.</h1><p>Your Wanterest workspace is ready to be created. This is real product access, not the waitlist. It&rsquo;s linked to your signed-in account &mdash; continue only if this is the account you want to use.</p>${account}<form method="post" action="/invite/complete"><div class="actions"><button class="button" type="submit">Accept invitation →</button></div></form>${cohort}<p class="note">Your workspace and cohort identity are created by the authoritative admission service after you confirm.</p></section>`);
}

/**
 * Apex 2.0 board 14 admission reveal. Shows only the cohort and number returned by the
 * authoritative admission transaction; an ordinary admission (no cohort) gets no cohort mark.
 * Motion is opacity + 8px rise only, with a static final state under reduced motion.
 */
export function admissionHtml(result: AdmissionResult) {
  const presentation = result.cohort && result.cohortNumber ? admittedCohortPresentation(result.cohort, result.cohortNumber) : null;
  const onboarding = `<dl class="meta"><div><dt>Cohort identity</dt><dd>${presentation ? `${presentation.label} · ${presentation.serial}` : "None"}</dd></div><div><dt>Onboarding</dt><dd>${result.onboardingStatus === "completed" ? "Complete" : "Ready to begin"}</dd></div></dl>`;
  const brand = `<div class="brand">${LOGO_MARK}<span>wanterest</span></div>`;
  if (!presentation) {
    return layout(`<div class="stack">${brand}<section class="card reveal is-admitted" aria-labelledby="admission-title"><div class="status stage"><i aria-hidden="true"></i>Admitted</div><h1 id="admission-title" class="stage s1">Welcome to Wanterest.</h1><p class="stage s2">Your invitation has been accepted and your workspace is ready. No cohort mark &mdash; ordinary admission after the first 125.</p>${onboarding}<div class="actions stage s3"><a class="button" href="/app">Open Wanterest</a></div><p class="note">This confirmation reflects the admission service result. It does not expose your invite token.</p></section></div>`);
  }
  const founding = presentation.cohort === "founding_25";
  const apex = apexSvgMarkup({ size: 16, fill: founding ? "founding-dark" : "early-light" }).replace("<svg ", '<svg class="key" ');
  const title = founding ? `You&rsquo;re Founding ${presentation.digits}.` : `You&rsquo;re Early ${presentation.digits}.`;
  const body = founding ? "One of the first 25 workspaces. This number is permanent." : "Among the first 125 workspaces. This number is permanent.";
  return layout(`<div class="stack">${brand}<section class="card reveal ${founding ? "is-founding" : "is-early"}" aria-labelledby="admission-title" data-cohort="${presentation.cohort}" data-cohort-number="${presentation.number}"><div class="reveal-label">${apex}<span>${founding ? "FOUNDING MEMBER" : "EARLY 100 MEMBER"}</span></div><h1 id="admission-title" class="stage s2">${title}</h1><div class="serial stage s1" aria-hidden="true"><b>${presentation.digits}</b><span>/${presentation.limit}</span></div><p class="stage s2">${body}</p>${onboarding}<div class="actions stage s3"><a class="button" href="/app">Open Wanterest</a></div><p class="note">This confirmation reflects the admission service result. It does not expose your invite token.</p></section></div>`);
}

export function unavailableHtml(title: string, detail: string) {
  return layout(`<section class="card" aria-labelledby="invite-error-title"><div class="mark">${LOGO_MARK}<span>wanterest</span></div><div class="pill"><span class="pill-dot" aria-hidden="true"></span><span class="pill-text">INVITATION</span></div><h1 id="invite-error-title">${title}</h1><p>${detail}</p><div class="actions"><a class="button outline" href="/">Return to Wanterest →</a></div></section>`);
}
