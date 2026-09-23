import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { LEGAL_LAST_UPDATED_LABEL } from "@/shared/config/seo";
import { SUPPORT_EMAIL } from "@/shared/config/site";

const TITLE = "Cookie Policy — Wanterest";
const DESCRIPTION = "Learn which cookies and similar technologies Wanterest uses for authentication, security, billing, preferences, and analytics.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/cookies" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/cookies" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function CookiesPage() {
  return (
    <MarketingPageShell>
      <main>
        <section className="marketing-section is-tight">
          <div className="marketing-section-inner marketing-section-readable marketing-legal">
            <h1 className="marketing-display-title marketing-section-title" style={{ textAlign: "left" }}>Cookie Policy</h1>
            <p className="marketing-legal-updated">Last updated: {LEGAL_LAST_UPDATED_LABEL}</p>

            <p>
              This page describes the cookies and similar technologies Wanterest actually uses today. We keep this list accurate as the product changes,
              rather than listing categories that don&rsquo;t apply to us.
            </p>

            <h2>Essential / Authentication</h2>
            <p>
              Wanterest uses cookies set by our authentication provider, Supabase Auth, to keep you signed in and to verify your session on each request.
              These cookies are required for the Service to function &mdash; without them, you would not be able to stay logged in.
            </p>

            <h2>Security</h2>
            <p>
              The same session cookies described above also help protect your account by ensuring requests are tied to an authenticated, verified
              session.
            </p>

            <h2>Billing / session</h2>
            <p>
              During checkout, our payment provider, Dodo Payments, may set its own cookies on its hosted checkout pages to process your payment securely.
              Wanterest does not control these directly; they are governed by Dodo Payments&rsquo; own policies while you are on their checkout pages.
            </p>

            <h2>Preferences</h2>
            <p>Wanterest does not currently set cookies to remember product preferences beyond your authenticated session.</p>

            <h2>Analytics</h2>
            <p>
              Wanterest does not currently use analytics cookies or any third-party analytics tooling. If we introduce analytics in the future, this page
              will be updated first, and the technology used will be listed here honestly.
            </p>

            <h2>Advertising and marketing cookies</h2>
            <p>Wanterest does not use advertising or marketing cookies of any kind.</p>

            <h2>Managing cookies</h2>
            <p>
              Most browsers let you block or delete cookies through their settings. Because the essential cookies above are required to keep you signed
              in, blocking them will prevent you from using the authenticated parts of Wanterest.
            </p>

            <h2>Changes to this policy</h2>
            <p>We will update this page and the &ldquo;Last updated&rdquo; date above if the cookies or technologies we use change.</p>

            <h2>Contact</h2>
            <p>
              Questions about this Cookie Policy can be sent to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. See also our{" "}
              <a href="/privacy">Privacy Policy</a>.
            </p>
          </div>
        </section>
      </main>
    </MarketingPageShell>
  );
}
