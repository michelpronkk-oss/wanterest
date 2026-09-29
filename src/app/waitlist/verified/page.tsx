import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveReveal } from "@/components/waitlist/journey";
import { JourneyShell } from "@/components/waitlist/journey-shell";
import { StatusUnavailableView, VerifiedReveal } from "@/components/waitlist/journey-views";
import { RevealActions } from "@/components/waitlist/share-my-place";
import { loadPrivateStatus, loadShareAvailability } from "../_lib/journey-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You're verified",
  robots: { index: false, follow: false },
};

/**
 * Design 05/06 — the Early Access identity reveal. /waitlist/verify redirects here after the
 * authoritative verification succeeds. A returning verified applicant can open it again at any
 * time from the same browser; the number shown is always the database's, never allocated here.
 */
export default async function VerifiedPage() {
  const status = await loadPrivateStatus();
  if (!status) {
    return <JourneyShell><StatusUnavailableView /></JourneyShell>;
  }
  const resolution = resolveReveal(status.application, status.referral, status.admission);
  if (resolution.kind === "redirect") redirect(resolution.to);

  const share = await loadShareAvailability(status.token);
  return (
    <JourneyShell>
      <VerifiedReveal model={resolution.model} actions={<RevealActions share={share} />} />
    </JourneyShell>
  );
}
