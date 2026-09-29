import type { Metadata } from "next";
import { cookies } from "next/headers";

import { CopyLinkButton } from "@/components/waitlist/copy-link-button";
import { describeStatus, earlyAccessLabel, formatJourneyDate } from "@/components/waitlist/journey";
import { JourneyShell } from "@/components/waitlist/journey-shell";
import { PrivateStatus, ReferralProgress, StatusUnavailableView } from "@/components/waitlist/journey-views";
import { ShareSection } from "@/components/waitlist/share-my-place";
import { WaitlistWithdrawButton } from "@/components/waitlist/waitlist-withdraw-button";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";
import { loadPrivateStatus, loadShareAvailability } from "../_lib/journey-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Early Access status",
  robots: { index: false, follow: false },
};

/**
 * Design 07/08/09/10 — the private status page. Reached from "View status" on the reveal, not as
 * the first post-verification screen. The credential is the HttpOnly status cookie only.
 */
export default async function WaitlistStatusPage() {
  const token = (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value ?? "";
  const status = token ? await loadPrivateStatus(token) : null;
  if (!status) return <JourneyShell><StatusUnavailableView /></JourneyShell>;

  const { application, referral, admission } = status;
  const view = describeStatus(application, referral, admission);
  const earlyAccess = earlyAccessLabel(application.earlyAccessNumber) ?? "Pending";
  const share = view.variant === "standard" || view.variant === "priority" || view.variant === "admitted" ? await loadShareAvailability() : null;

  return (
    <JourneyShell>
      <PrivateStatus
        view={view}
        earlyAccess={earlyAccess}
        details={{ submitted: formatJourneyDate(application.createdAt), company: application.companyName, email: application.email, marketingConsent: application.marketingConsent }}
        withdraw={<WaitlistWithdrawButton />}
        referral={referral?.shareUrl ? <ReferralProgress verifiedCount={referral.verifiedCount} threshold={referral.threshold} copyButton={<CopyLinkButton url={referral.shareUrl} />} /> : null}
        share={share && application.earlyAccessNumber ? <section className="ea-status-share"><ShareSection share={share} /></section> : null}
      />
    </JourneyShell>
  );
}
