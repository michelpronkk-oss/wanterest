import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { DifferenceStage } from "@/components/marketing/difference";
import { APP_START_URL } from "@/components/marketing/links";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { Reveal } from "@/components/marketing/reveal";

const TITLE = "Wanterest Product — Turn Real Demand Into Intelligence";
const DESCRIPTION = "See how Wanterest finds product pain, switching intent, feature demand, comparisons, and market movement from real public conversations.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/product" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/product" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const FLOW_STEPS = [
  { num: "01", label: "UNDERSTAND", body: "Maps your product, audience, pains, and buyer language." },
  { num: "02", label: "FIND", body: "Finds real conversations showing pain, intent, and switching signals." },
  { num: "03", label: "MAP", body: "Groups qualified demand into themes, gaps, movement, and geography." },
  { num: "04", label: "ACT", body: "Turns market evidence into clear actions for product and growth.", accent: true },
];

const DEMAND_MAP = [
  { label: "Workflow simplicity", value: 148, pct: 62, accent: true },
  { label: "Predictable pricing", value: 96, pct: 48 },
  { label: "SSO & permissions", value: 74, pct: 37 },
  { label: "Migration pain", value: 51, pct: 26 },
  { label: "AI automation", value: 35, pct: 18 },
];

const GEO_MARKERS = [
  { label: "United States", x: 24, y: 34, size: "lg", primary: true, delay: 0 },
  { label: "United Kingdom", x: 42, y: 23, size: "sm", primary: false, delay: 0.4 },
  { label: "Germany", x: 45, y: 21, size: "sm", primary: false, delay: 0.9 },
  { label: "India", x: 59, y: 46, size: "md", primary: false, delay: 1.3 },
  { label: "Australia", x: 70, y: 78, size: "sm", primary: false, delay: 0.7 },
] as const;

const DEMAND_DRIFT = [
  { label: "Pricing pain", value: "↑ 31%", direction: "up" },
  { label: "SSO demand", value: "↑ 9%", direction: "up" },
  { label: "Migration pain", value: "↓ 4%", direction: "down" },
  { label: "Competitor X mentions", value: "↑ 12%", direction: "up" },
] as const;

const TRADITIONAL_POINTS = [
  { title: "Company filters", full: "Find companies that match your ICP.", short: "Find companies that match your ICP." },
  { title: "Contact lists", full: "Get names and email addresses.", short: "Get names and email addresses." },
  { title: "Enrichment", full: "Fill in firmographic and contact data.", short: "Fill in firmographic and contact data." },
  { title: "Outbound targets", full: "Build cold outreach lists to hit quota.", short: "Build cold outreach lists to hit quota." },
];

const WANTEREST_POINTS = [
  { title: "Real conversations", full: "People discussing your problem in the wild.", short: "People discussing your problem." },
  { title: "Visible pain", full: "See exactly what they are struggling with.", short: "See what they are struggling with." },
  { title: "Switching intent", full: "Buyers looking for an alternative right now.", short: "Buyers looking for an alternative." },
  { title: "Feature demand", full: "What buyers wish your category could do.", short: "What buyers wish your category could do." },
  { title: "Market movement", full: "Track pain and intent as they shift over time.", short: "Track pain and intent over time." },
  { title: "Competitive context", full: "See how you stack up in real conversations.", short: "See how you stack up against rivals." },
];

export default function ProductPage() {
  return (
    <MarketingPageShell activeHref="/product">
      <main>
        {/* 1. HERO */}
        <section className="marketing-product-hero">
          <div className="marketing-product-hero-copy">
            <div className="marketing-content-eyebrow">
              <span className="marketing-content-eyebrow-dot" />
              PRODUCT
            </div>
            <h1 className="marketing-product-hero-title">See what the market already wants.</h1>
            <p className="marketing-product-hero-body">
              Wanterest finds real product pain, switching intent, feature demand, comparisons, and market movement, then turns it into intelligence your team can act on.
            </p>
            <div className="marketing-product-hero-actions">
              <a className="marketing-cta" href={APP_START_URL}>Scan your product</a>
              <Link className="marketing-product-link-muted" href="#how-it-works">See how it works →</Link>
            </div>
          </div>

          <div className="marketing-product-hero-visual" aria-hidden="true">
            <div className="marketing-product-hero-visual-glow" />

            <div className="marketing-product-movement-chip">
              <span className="marketing-product-movement-chip-label">MARKET MOVEMENT</span>
              <span className="marketing-product-movement-chip-value">+31%</span>
            </div>

            <svg className="marketing-product-hero-trajectory" viewBox="0 0 500 200" preserveAspectRatio="none">
              <path d="M -10,150 C 60,158 90,130 140,132 C 190,134 210,90 270,92 C 330,94 350,50 420,42 C 460,37 480,30 510,20" fill="none" stroke="#D7FF3D" strokeWidth="2" opacity="0.35" />
              <circle cx="420" cy="42" r="4" fill="#D7FF3D" opacity="0.9" />
            </svg>

            <div className="marketing-product-demand-card">
              <div className="marketing-product-demand-card-eyebrow">
                <span className="marketing-product-demand-card-dot" />
                SWITCHING INTENT · 94%
              </div>
              <p className="marketing-product-demand-card-quote">&ldquo;Looking for a cheaper HubSpot alternative with SSO.&rdquo;</p>
            </div>
          </div>
        </section>

        {/* 2. PRODUCT FLOW */}
        <section className="marketing-product-section" id="how-it-works">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">HOW IT WORKS</p>
            <h2 className="marketing-product-block-title is-standalone">From product to demand intelligence.</h2>
            <div className="marketing-product-flow">
              <div className="marketing-product-flow-line" aria-hidden="true" />
              {FLOW_STEPS.map((step, index) => (
                <Reveal key={step.num} delay={index * 80}>
                  <div className="marketing-product-flow-step">
                    <div className={`marketing-product-flow-num${step.accent ? " is-accent" : ""}`}>{step.num}</div>
                    <p className="marketing-product-flow-label">{step.label}</p>
                    <p className="marketing-product-flow-body">{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* 3. SIGNALS: NOISE VS QUALIFIED */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">QUALIFIED SIGNALS</p>
            <h2 className="marketing-product-block-title">Not every mention is demand.</h2>
            <p className="marketing-product-block-subtitle">
              Wanterest qualifies conversations for relevance, evidence, pain, intent, specificity, and commercial context before they shape your intelligence.
            </p>

            <div className="marketing-product-signals-grid">
              <Reveal>
                <div className="marketing-product-noise-card">
                  <p className="marketing-product-noise-label">NOISE</p>
                  <p className="marketing-product-noise-quote">&ldquo;HubSpot lol&rdquo;</p>
                  <div className="marketing-product-noise-meta">
                    <span>500K likes</span>
                    <span>Not a signal</span>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={80}>
                <div className="marketing-product-qualified-card">
                  <div className="marketing-product-qualified-label-row">
                    <span className="marketing-product-qualified-dot" />
                    <span className="marketing-product-qualified-label">QUALIFIED DEMAND</span>
                  </div>
                  <p className="marketing-product-qualified-quote">&ldquo;Looking for a cheaper HubSpot alternative with SSO.&rdquo;</p>
                  <div className="marketing-product-qualified-meta">
                    <span>2 likes</span>
                    <span className="is-accent">Switching intent · 94%</span>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* 4. DEMAND MAP */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">DEMAND MAP</p>
            <h2 className="marketing-product-block-title">See what your market keeps asking for.</h2>
            <p className="marketing-product-block-subtitle">
              Wanterest groups qualified signals into recurring themes so you can see where demand is concentrated.
            </p>

            <div className="marketing-product-bars">
              {DEMAND_MAP.map((row, index) => (
                <Reveal key={row.label} delay={index * 90}>
                  <div className="marketing-product-bar-row">
                    <span className="marketing-product-bar-label">{row.label}</span>
                    <span className="marketing-product-bar-track">
                      <span
                        className={`marketing-product-bar-fill${row.accent ? " is-accent" : ""}`}
                        style={{ width: `${row.pct}%`, transitionDelay: `${index * 90 + 120}ms` }}
                      />
                    </span>
                    <span className="marketing-product-bar-value">{row.value}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* 5. DEMAND GAP */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">DEMAND GAP</p>
            <h2 className="marketing-product-block-title">See what buyers want that nobody fully owns yet.</h2>
            <p className="marketing-product-block-subtitle">
              Compare market demand against your product and competitors to uncover unmet needs and open positioning territory.
            </p>

            <Reveal>
              <div className="marketing-product-gap-visual" aria-hidden="true">
                <div className="marketing-product-gap-circle is-product"><span>Your product</span></div>
                <div className="marketing-product-gap-circle is-competitor"><span>Competitor</span></div>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="marketing-product-gap-caption-row">
                <p className="marketing-product-gap-caption">27% of conversations mention neither product.</p>
              </div>
              <p className="marketing-product-gap-conclusion">Open demand for whoever claims it first.</p>
            </Reveal>
          </div>
        </section>

        {/* 6. DEMAND DRIFT */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">DEMAND DRIFT</p>
            <h2 className="marketing-product-block-title">See what is changing before it becomes obvious.</h2>
            <p className="marketing-product-block-subtitle">
              Track how pain, switching intent, comparisons, objections, and feature demand move over time.
            </p>

            <div className="marketing-product-drift-list">
              {DEMAND_DRIFT.map((row) => (
                <div className="marketing-product-drift-row" key={row.label}>
                  <span className="marketing-product-drift-label">{row.label}</span>
                  <span className={`marketing-product-drift-value is-${row.direction}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. GEOGRAPHY */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">GEOGRAPHY</p>
            <h2 className="marketing-product-block-title">Know where demand is forming.</h2>
            <p className="marketing-product-block-subtitle">
              See which countries and regions show the strongest qualified demand, what each market cares about, and where momentum is shifting.
            </p>

            <Reveal>
              <div className="marketing-product-geo-row">
                <div className="marketing-product-geo-map">
                  <Image
                    src="/marketing/geo-map.png"
                    alt="World map highlighting regions with qualified demand"
                    fill
                    sizes="(max-width: 860px) 100vw, 620px"
                    className="marketing-product-geo-map-img"
                    style={{ objectFit: "cover", objectPosition: "top" }}
                  />
                  <div className="marketing-product-geo-map-glow" aria-hidden="true" />
                  <div className="marketing-product-geo-map-fade" aria-hidden="true" />
                  {GEO_MARKERS.map((marker) => (
                    <span
                      key={marker.label}
                      className={`marketing-geo-marker is-${marker.size}${marker.primary ? " is-primary" : ""}`}
                      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                      aria-hidden="true"
                    >
                      <span className="marketing-geo-marker-dot" style={{ animationDelay: `${marker.delay}s` }} />
                    </span>
                  ))}
                  <div className="marketing-product-geo-map-chip">
                    <span className="marketing-product-geo-map-chip-dot" />
                    UNITED STATES · 184 SIGNALS
                  </div>
                </div>
                <div className="marketing-product-geo-stats">
                  <p className="marketing-product-geo-country">UNITED STATES</p>
                  <p className="marketing-product-geo-count">184 <span>qualified signals</span></p>
                  <p className="marketing-product-geo-change">+28% this quarter</p>
                  <p className="marketing-product-geo-top">Top demand: predictable pricing</p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 8. ACTIONS */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">ACTIONS</p>
            <h2 className="marketing-product-block-title">Turn market evidence into what to do next.</h2>
            <p className="marketing-product-block-subtitle">
              Wanterest converts qualified demand into practical actions for product, positioning, growth, and market expansion.
            </p>

            <div className="marketing-product-action-card">
              <p className="marketing-product-action-summary">Pricing-related switching demand is accelerating in the US.</p>
              <div className="marketing-product-action-rec">
                <p className="marketing-product-action-rec-label">RECOMMENDED</p>
                <p className="marketing-product-action-rec-title">Test positioning around predictable pricing in US campaigns.</p>
                <p className="marketing-product-action-rec-meta">42 qualified switching signals across 4 sources.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 9. DIFFERENCE */}
        <section className="marketing-product-section">
          <div className="marketing-content-wrap">
            <p className="marketing-product-eyebrow">WHY WANTEREST</p>
            <h2 className="marketing-product-block-title is-compact">
              Lead finders show you who might fit.
              <br />
              Wanterest shows you what the market actually wants.
            </h2>

            <Reveal>
              <DifferenceStage
                oldCardTitle="Lead finder"
                oldPoints={TRADITIONAL_POINTS}
                modernPoints={WANTEREST_POINTS}
              />
            </Reveal>
          </div>
        </section>

        {/* 10. PHILOSOPHY */}
        <section className="marketing-product-philosophy">
          <h2 className="marketing-product-philosophy-title">
            Engagement does not create demand.
            <br />
            Intent does.
          </h2>
          <p className="marketing-product-philosophy-body">A viral post can still be noise. A tiny conversation can reveal real switching intent.</p>
        </section>

        {/* 11. CLOSING CTA */}
        <section className="marketing-product-closing">
          <div className="marketing-product-closing-glow" aria-hidden="true" />
          <div className="marketing-product-closing-inner">
            <div>
              <div className="marketing-content-eyebrow is-on-dark">
                <span className="marketing-content-eyebrow-dot" />
                START WITH YOUR PRODUCT
              </div>
              <h2 className="marketing-product-closing-title">
                The demand is already there.
                <br />
                Find it.
              </h2>
            </div>
            <div className="marketing-product-closing-side">
              <p className="marketing-product-closing-copy">Scan your product and see what real conversations reveal.</p>
              <div className="marketing-product-closing-actions">
                <a className="marketing-product-closing-cta" href={APP_START_URL}>Scan your product</a>
                <Link className="marketing-product-closing-link" href="/pricing">View pricing →</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </MarketingPageShell>
  );
}
