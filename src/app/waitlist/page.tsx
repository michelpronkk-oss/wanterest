import type { Metadata } from "next";
import { cookies } from "next/headers";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { MembershipLadder } from "@/components/waitlist/membership-ladder";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import { getProductAccessState } from "@/server/modules/access";
import { createWaitlistService } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";
import { APP_SIGNUP_URL } from "@/components/marketing/links";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Early Access",
  description: "Request Early Access to Wanterest.",
  alternates: { canonical: "/waitlist" },
};

/**
 * The public submission boundary is deliberately silent about duplicates (no email-enumeration
 * oracle), so "you've already applied" can only ever be told honestly from the visitor's own
 * session — never inferred from a form response. A stored status cookie is that session.
 */
async function existingApplicantStatus(): Promise<"eligible" | null> {
  const token = (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value;
  if (!token) return null;
  try {
    const application = await createWaitlistService().status(token);
    return application.status === "declined" || application.status === "withdrawn" ? null : "eligible";
  } catch {
    return null;
  }
}

export default async function WaitlistPage() {
  const [access, existingApplicant] = await Promise.all([getProductAccessState(), existingApplicantStatus()]);
  return (
    <MarketingPageShell activeHref="/waitlist">
      <main className="ea-page" aria-labelledby="waitlist-title">
        <div className="ea-hero">
          <div className="ea-copy-col">
            <div className="ea-eyebrow-pill"><span className="ea-eyebrow-dot" /><span className="ea-eyebrow-text">EARLY ACCESS</span></div>
            {access.canRequestAccess ? (
              <>
                <h1 id="waitlist-title" className="ea-title">See what your market wants before anyone else does.</h1>
                <p className="ea-lede">Wanterest tracks public demand, emerging pain and switching intent across the conversations your buyers already have.</p>
                <p className="ea-note"><strong>Early Access is a place in line, not an account.</strong> We review requests and open workspaces in waves.</p>
              </>
            ) : (
              <>
                <h1 id="waitlist-title" className="ea-title">Wanterest is open.</h1>
                <p className="ea-lede">Start a secure account to begin your workspace right away.</p>
                <p className="ea-note"><strong>Early Access is historical.</strong> New public signups do not create waitlist or Priority identities.</p>
              </>
            )}
          </div>
          <div className="ea-form-col">
            {access.canRequestAccess && existingApplicant ? (
              <section className="ea-form-card ea-form-card-notice" aria-label="Existing Early Access request">
                <div className="ea-form-heading"><h2>You&rsquo;re already on the list.</h2><p>We found a private status link stored in this browser.</p></div>
                <a className="dashboard-button dashboard-button-primary ea-submit" href="/waitlist/status">View my status →</a>
              </section>
            ) : access.canRequestAccess ? (
              <section className="ea-form-card" aria-label="Wanterest Early Access application"><WaitlistForm /></section>
            ) : (
              <section className="ea-form-card" aria-label="Start Wanterest">
                <div className="ea-form-heading"><h2>Start free</h2><p>No waitlist. Your workspace is ready as soon as you sign up.</p></div>
                <a className="dashboard-button dashboard-button-primary ea-submit" href={APP_SIGNUP_URL}>Start free →</a>
              </section>
            )}
          </div>
          {access.canRequestAccess ? <div className="ea-ladder-col"><MembershipLadder /></div> : null}
        </div>
      </main>
    </MarketingPageShell>
  );
}
