import { createWaitlistService } from "@/server/modules/waitlist";
import { cookies } from "next/headers";

import { WaitlistWithdrawButton } from "@/components/waitlist/waitlist-withdraw-button";
import { ShareCardPanel } from "@/components/share-cards/share-card-panel";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";
import { getApplicantShareCardsQuery } from "@/server/modules/share-cards";

export const dynamic = "force-dynamic";

export default async function WaitlistStatusPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(WAITLIST_STATUS_COOKIE)?.value ?? "";
  if (!token) return <StatusUnavailable />;
  const status = await loadStatus(token);
  if (!status) return <StatusUnavailable />;
  const shareCards = await getApplicantShareCardsQuery(token).catch(() => []);
  const { application, referral, admission } = status;
  return (
    <MarketingPageShell activeHref="/waitlist">
      <main className="waitlist-status-page">
        <div className="waitlist-status-card">
        <div className="marketing-content-eyebrow">YOUR EARLY ACCESS REQUEST</div>
        <h1>{admission?.admissionStatus === "admitted" ? "Your Wanterest access is ready." : "You're on the list."}</h1>
        <p className="waitlist-status-intro">{admission?.admissionStatus === "admitted" ? "Your invitation is complete and your workspace is ready." : "Your request is stored privately. Joining the waitlist does not grant dashboard access."}</p>
        <dl className="waitlist-status-details">
          <div><dt>Early Access</dt><dd>{application.earlyAccessNumber ? `#${String(application.earlyAccessNumber).padStart(4, "0")}` : "Pending verification"}</dd></div>
          <div><dt>Status</dt><dd>{formatStatus(application.status)}</dd></div>
          <div><dt>Submitted</dt><dd>{new Date(application.createdAt).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}</dd></div>
          <div><dt>Company</dt><dd>{application.companyName}</dd></div>
          {admission?.inviteStatus ? <div><dt>Invitation</dt><dd>{formatStatus(admission.inviteStatus)}</dd></div> : null}
          {admission?.admissionStatus === "admitted" ? <div><dt>Workspace access</dt><dd>Admitted</dd></div> : null}
          {admission?.displayIdentity ? <div><dt>Cohort identity</dt><dd>{admission.displayIdentity} · #{String(admission.cohortNumber).padStart(admission.cohort === "founding_25" ? 2 : 3, "0")}</dd></div> : null}
        </dl>
        {referral ? <section aria-label="Referral progress">
          <div className="marketing-content-eyebrow">PRIORITY ACCESS</div>
          <p className="waitlist-status-intro">{referral.priorityUnlocked ? "Priority Access unlocked." : `${referral.verifiedCount} of ${referral.threshold} verified referrals`}</p>
          {!referral.priorityUnlocked ? <p className="waitlist-status-footnote">{referral.remainingCount} more verified referral{referral.remainingCount === 1 ? "" : "s"} to unlock Priority Access.</p> : null}
          {referral.shareUrl ? <p className="waitlist-status-footnote"><a href={referral.shareUrl}>{referral.shareUrl}</a></p> : null}
        </section> : null}
        {application.status !== "withdrawn" && application.status !== "declined" ? <WaitlistWithdrawButton /> : null}
        <ShareCardPanel endpoint="/api/share-cards/applicant" initialCards={shareCards} title="Share your access identity" />
        <p className="waitlist-status-footnote">Early Access numbers are historical identities, not permissions. Priority Access is a waitlist state, not a product permission. Cohort identity and workspace access are created only after authoritative admission.</p>
        </div>
      </main>
    </MarketingPageShell>
  );
}

async function loadStatus(token: string) {
  try { return await createWaitlistService().statusWithReferral(token); } catch { return null; }
}

function formatStatus(status: string) { return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function StatusUnavailable() {
  return (
    <MarketingPageShell activeHref="/waitlist">
      <main className="waitlist-status-page">
        <div className="waitlist-status-card">
          <div className="marketing-content-eyebrow">EARLY ACCESS</div>
          <h1>Status unavailable.</h1>
          <p>Use the private status link from your Wanterest email.</p>
          <a className="dashboard-button dashboard-button-primary" href="/waitlist">Back to Early Access</a>
        </div>
      </main>
    </MarketingPageShell>
  );
}
