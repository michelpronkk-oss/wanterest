import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { CheckEmailPanel } from "@/components/waitlist/check-email-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check your email",
  description: "Confirm your Wanterest Early Access request.",
  robots: { index: false, follow: false },
};

/**
 * A genuine separate screen, not a state nested in the two-column landing page: no headline,
 * no membership ladder, no form card. The personalized content (which email, resend payload)
 * lives in sessionStorage on the client — see check-email-storage.ts for why there is no
 * server-side session to read here instead.
 */
export default function CheckEmailPage() {
  return (
    <MarketingPageShell activeHref="/waitlist">
      <main className="ea-check-email-page">
        <CheckEmailPanel />
      </main>
    </MarketingPageShell>
  );
}
