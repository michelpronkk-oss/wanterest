import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import { getProductAccessState } from "@/server/modules/access";
import { APP_SIGNUP_URL } from "@/components/marketing/links";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Early Access",
  description: "Request Early Access to Wanterest.",
  alternates: { canonical: "/waitlist" },
};

export default async function WaitlistPage() {
  const access = await getProductAccessState();
  return (
    <MarketingPageShell>
      <main className="marketing-content-wrap waitlist-page" aria-labelledby="waitlist-title">
        <section className="waitlist-hero">
          <div className="marketing-content-eyebrow"><span className="marketing-content-eyebrow-dot" /> EARLY ACCESS</div>
          <h1 id="waitlist-title" className="marketing-display-title waitlist-title">See what people actually want.</h1>
          {access.canRequestAccess ? <>
            <p className="waitlist-lede">Join the Wanterest Early Access list. We&rsquo;ll review requests and invite people separately when access is available.</p>
            <div className="waitlist-notice" role="note">
              <strong>Early Access is not dashboard access.</strong>
              <span>Joining does not create an account, workspace, subscription, or Founding 25 membership.</span>
            </div>
          </> : <>
            <p className="waitlist-lede">Wanterest is open. Start a secure account to begin your workspace.</p>
            <div className="waitlist-notice" role="note">
              <strong>Early Access is historical.</strong>
              <span>New public signups do not create waitlist or Priority identities.</span>
            </div>
          </>}
        </section>
        {access.canRequestAccess ? <section className="waitlist-card" aria-label="Wanterest Early Access application"><WaitlistForm /></section> : <section className="waitlist-card" aria-label="Start Wanterest"><a className="dashboard-button dashboard-button-primary" href={APP_SIGNUP_URL}>Start free →</a></section>}
      </main>
    </MarketingPageShell>
  );
}
