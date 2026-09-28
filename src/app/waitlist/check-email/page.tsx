import type { Metadata } from "next";

import { earlyAccessLabel } from "@/components/waitlist/journey";
import { JourneyShell } from "@/components/waitlist/journey-views";
import { CheckEmailPanel } from "@/components/waitlist/check-email-panel";
import { loadPrivateStatus } from "../_lib/journey-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check your email",
  description: "Confirm your Wanterest Early Access request.",
  robots: { index: false, follow: false },
};

/**
 * Design 04 — a dedicated screen after submission, not a state inside the two-column landing.
 * Personalised content comes from sessionStorage (see check-email-storage.ts). If this browser
 * already holds a verified private status, that authoritative record wins: a verified applicant
 * is never shown as awaiting verification.
 */
export default async function CheckEmailPage() {
  const status = await loadPrivateStatus();
  const verified = status && status.application.emailVerificationStatus === "verified" && status.application.earlyAccessNumber
    ? { email: status.application.email, earlyAccess: earlyAccessLabel(status.application.earlyAccessNumber) ?? "" }
    : null;
  return (
    <JourneyShell nav="marketing">
      <main className="ea-check-email-page" aria-labelledby="check-email-title">
        <CheckEmailPanel verified={verified} />
      </main>
    </JourneyShell>
  );
}
