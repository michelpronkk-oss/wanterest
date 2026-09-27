import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";

export const metadata: Metadata = {
  title: "Early Access",
  description: "Request Early Access to Wanterest.",
  alternates: { canonical: "/waitlist" },
};

export default function WaitlistPage() {
  return (
    <MarketingPageShell>
      <main className="marketing-content-wrap waitlist-page" aria-labelledby="waitlist-title">
        <section className="waitlist-hero">
          <div className="marketing-content-eyebrow"><span className="marketing-content-eyebrow-dot" /> EARLY ACCESS</div>
          <h1 id="waitlist-title" className="marketing-display-title waitlist-title">See what people actually want.</h1>
          <p className="waitlist-lede">Join the Wanterest Early Access list. We&rsquo;ll review requests and invite people separately when access is available.</p>
          <div className="waitlist-notice" role="note">
            <strong>Early Access is not dashboard access.</strong>
            <span>Joining does not create an account, workspace, subscription, or Founding 25 membership.</span>
          </div>
        </section>
        <section className="waitlist-card" aria-label="Wanterest Early Access application">
          <WaitlistForm />
        </section>
      </main>
    </MarketingPageShell>
  );
}
