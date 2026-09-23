import type { Metadata } from "next";
import Link from "next/link";

import { APP_START_URL } from "@/components/marketing/links";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { Reveal } from "@/components/marketing/reveal";

const TITLE = "About Wanterest — Built Around Real Market Demand";
const DESCRIPTION = "Wanterest helps teams stop guessing what markets want by turning real public conversations into qualified demand intelligence.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/about" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const PRINCIPLES = [
  { title: "Real conversations", body: "Wanterest starts with actual public conversations, not assumptions." },
  { title: "Qualified demand", body: "Not every mention matters. Wanterest qualifies evidence for pain, intent, specificity, and commercial relevance." },
  { title: "Clearer decisions", body: "Turn market evidence into better product, positioning, and growth decisions." },
];

export default function AboutPage() {
  return (
    <MarketingPageShell activeHref="/about">
      <main>
        {/* Hero */}
        <section className="marketing-content-wrap marketing-content-split marketing-about-hero">
          <div className="marketing-about-hero-copy">
            <div className="marketing-content-eyebrow">
              <span className="marketing-content-eyebrow-dot" />
              ABOUT WANTEREST
            </div>
            <h1 className="marketing-about-hero-title">Stop guessing what the market wants.</h1>
            <p className="marketing-about-hero-body">
              Wanterest turns real public conversations into qualified demand intelligence, so teams can see what buyers want, where markets are moving, and what to act on next.
            </p>
          </div>
          <div className="marketing-about-hero-visual" aria-hidden="true">
            <div className="marketing-about-hero-visual-glow" />
            <svg className="marketing-about-hero-visual-line" viewBox="0 0 500 260" width="100%" height="100%" preserveAspectRatio="none" focusable="false">
              <polyline points="20,190 110,170 190,200 270,130 350,150 430,70" fill="none" stroke="#d7ff3d" strokeWidth="1.5" opacity="0.22" />
            </svg>
            <div className="marketing-about-hero-visual-content">
              <div className="marketing-about-quote-card">
                <div className="marketing-about-quote-eyebrow">
                  <span className="marketing-about-quote-dot" />
                  QUALIFIED DEMAND
                </div>
                <p className="marketing-about-quote-text">&ldquo;Looking for a cheaper alternative with SSO.&rdquo;</p>
              </div>
              <div style={{ display: "flex", gap: 10, marginLeft: 16 }}>
                <div className="marketing-about-movement-chip">
                  MARKET MOVEMENT <strong>+28%</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Belief */}
        <section className="marketing-content-wrap marketing-content-split marketing-about-belief">
          <div className="marketing-about-belief-label">
            <p className="marketing-about-belief-eyebrow">OUR BELIEF</p>
            <h2 className="marketing-about-belief-title">The market already tells you what it wants.</h2>
          </div>
          <div className="marketing-about-belief-copy">
            <p>Every day, buyers describe their problems, compare alternatives, ask for missing capabilities, and explain why they switch.</p>
            <p>That demand already exists in public conversations.</p>
            <p className="is-strong">Wanterest finds those conversations, qualifies the evidence, and turns it into intelligence teams can actually use.</p>
          </div>
        </section>

        {/* Principles */}
        <section className="marketing-content-wrap marketing-about-principles">
          <div className="marketing-about-principles-grid">
            {PRINCIPLES.map((principle, index) => (
              <Reveal key={principle.title} delay={index * 80}>
                <div className="marketing-about-principle-card">
                  <div className="marketing-about-principle-bar" />
                  <h2 className="marketing-about-principle-title">{principle.title.toUpperCase()}</h2>
                  <p className="marketing-about-principle-body">{principle.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Closing CTA band */}
        <section className="marketing-about-closing">
          <div className="marketing-content-wrap marketing-content-split marketing-about-closing-inner">
            <div>
              <div className="marketing-content-eyebrow is-on-dark">
                <span className="marketing-content-eyebrow-dot" />
                FROM SIGNAL TO DECISION
              </div>
              <h2 className="marketing-about-closing-title">
                Stop guessing.
                <br />
                Start finding.
              </h2>
            </div>
            <div className="marketing-about-closing-side">
              <p className="marketing-about-closing-copy">See what your market is already telling you.</p>
              <div className="marketing-about-closing-actions">
                <a className="marketing-about-closing-cta" href={APP_START_URL}>Scan your product</a>
                <Link className="marketing-about-closing-link" href="/product">Explore Wanterest →</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </MarketingPageShell>
  );
}
