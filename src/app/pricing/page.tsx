import type { Metadata } from "next";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { PricingSection } from "@/components/marketing/pricing";

const TITLE = "Wanterest Pricing — Free, Pro & Growth Plans";
const DESCRIPTION = "Start finding real demand for free. Upgrade for automatic monitoring, deeper market history, more products, experiments, and broader demand intelligence.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/pricing" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function PricingPage() {
  return (
    <MarketingPageShell>
      <main>
        <section className="marketing-section is-tight">
          <div className="marketing-section-inner marketing-section-readable" style={{ textAlign: "center" }}>
            <h1 className="marketing-display-title marketing-section-title">
              Start with real demand.
              <br />
              Scale when you need more.
            </h1>
            <p className="marketing-section-copy">
              Scan your first product for free. Upgrade when you want continuous monitoring, deeper history, more products, and broader intelligence.
            </p>
          </div>
        </section>

        {/* PricingSection is the single source of pricing copy, shared with the homepage,
            so plan names/prices/features can never drift between the two pages. */}
        <PricingSection />
      </main>
    </MarketingPageShell>
  );
}
