import { createWaitlistService } from "@/server/modules/waitlist";
import { cookies } from "next/headers";

import { WaitlistWithdrawButton } from "@/components/waitlist/waitlist-withdraw-button";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";

export const dynamic = "force-dynamic";

export default async function WaitlistStatusPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(WAITLIST_STATUS_COOKIE)?.value ?? "";
  if (!token) return <StatusUnavailable />;
  const application = await loadStatus(token);
  if (!application) return <StatusUnavailable />;
  return (
    <main className="waitlist-status-page">
      <div className="waitlist-status-card">
        <div className="marketing-content-eyebrow">YOUR EARLY ACCESS REQUEST</div>
        <h1>You&rsquo;re on the list.</h1>
        <p className="waitlist-status-intro">Your request is stored privately. Joining the waitlist does not grant dashboard access.</p>
        <dl className="waitlist-status-details">
          <div><dt>Early Access</dt><dd>{application.earlyAccessNumber ? `#${String(application.earlyAccessNumber).padStart(4, "0")}` : "Pending verification"}</dd></div>
          <div><dt>Status</dt><dd>{formatStatus(application.status)}</dd></div>
          <div><dt>Submitted</dt><dd>{new Date(application.createdAt).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}</dd></div>
          <div><dt>Company</dt><dd>{application.companyName}</dd></div>
        </dl>
        {application.status !== "withdrawn" && application.status !== "declined" ? <WaitlistWithdrawButton /> : null}
        <p className="waitlist-status-footnote">Early Access numbers are historical identities, not permissions. Founding 25 and Early 100 are separate future cohorts.</p>
      </div>
    </main>
  );
}

async function loadStatus(token: string) {
  try { return await createWaitlistService().status(token); } catch { return null; }
}

function formatStatus(status: string) { return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function StatusUnavailable() { return <main className="waitlist-status-page"><div className="waitlist-status-card"><div className="marketing-content-eyebrow">EARLY ACCESS</div><h1>Status unavailable.</h1><p>Use the private status link from your Wanterest email.</p><a className="dashboard-button dashboard-button-primary" href="/waitlist">Back to Early Access</a></div></main>; }
