import { admissionHtml, reviewHtml } from "@/app/invite/complete/admission-html";
import type { AdmissionResult } from "@/server/modules/waitlist";

export const dynamic = "force-dynamic";

/**
 * VISUAL-QA FIXTURE ONLY: renders the real /invite/complete HTML builders with
 * fictional results. Never runs an admission. 404 outside APEX_FIXTURES=1 dev.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.APEX_FIXTURES !== "1") return new Response("Not found", { status: 404 });
  const variant = new URL(request.url).searchParams.get("variant") ?? "founding";
  const base: AdmissionResult = {
    admissionId: "00000000-0000-4000-8000-0000000000a1", inviteId: "00000000-0000-4000-8000-0000000000a2", waitlistApplicationId: "00000000-0000-4000-8000-0000000000a3",
    userId: "00000000-0000-4000-8000-0000000000a4", workspaceId: "00000000-0000-4000-8000-0000000000a5", cohort: "founding_25", cohortNumber: 7, cohortLimit: 25,
    benefitPolicyKey: null, benefitStatus: null, profileInitialized: true, onboardingStatus: "required", admittedAt: "2026-09-28T12:00:00Z", idempotent: false,
  };
  const html = variant === "review" ? reviewHtml("fixture@example.test")
    : variant === "early" ? admissionHtml({ ...base, cohort: "early_100", cohortNumber: 42, cohortLimit: 100 })
      : variant === "none" ? admissionHtml({ ...base, cohort: null, cohortNumber: null, cohortLimit: null })
        : admissionHtml(base);
  return new Response(html.replace("<body>", '<body><div style="padding:8px 16px;background:#fff3c4;color:#6b4e00;font:700 12px sans-serif;text-align:center">VISUAL QA FIXTURE — fictional admission result</div>'), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
