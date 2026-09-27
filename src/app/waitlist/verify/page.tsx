import { redirect } from "next/navigation";

import { createWaitlistService } from "@/server/modules/waitlist";
import { waitlistStatusTokenSchema, waitlistVerificationTokenSchema } from "@/server/modules/waitlist";
import { SITE_ORIGIN } from "@/shared/config/site";

export const dynamic = "force-dynamic";

export default async function WaitlistVerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const statusToken = typeof query.status === "string" ? query.status : "";
  if (!waitlistVerificationTokenSchema.safeParse(token).success || !waitlistStatusTokenSchema.safeParse(statusToken).success) {
    return <VerificationFailure />;
  }
  try {
    await createWaitlistService().verify(token);
    redirect(`${SITE_ORIGIN}/waitlist/status?token=${encodeURIComponent(statusToken)}`);
  } catch {
    return <VerificationFailure />;
  }
}

function VerificationFailure() {
  return (
    <main className="waitlist-status-page">
      <div className="waitlist-status-card">
        <div className="marketing-content-eyebrow">EARLY ACCESS</div>
        <h1>That link is no longer available.</h1>
        <p>Request a new verification email from the Early Access form.</p>
        <a className="dashboard-button dashboard-button-primary" href="/waitlist">Back to Early Access</a>
      </div>
    </main>
  );
}
