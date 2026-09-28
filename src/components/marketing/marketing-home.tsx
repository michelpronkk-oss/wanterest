import Image from "next/image";

import type { HomepageAccessState } from "@/server/modules/access";
import { APP_ORIGIN } from "@/shared/config/site";
import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { BeyondSignalsTabs } from "./beyond-signals";
import { DifferenceSection } from "./difference";
import { Faq } from "./faq";
import { APP_START_URL } from "./links";
import { MarketingFooter } from "./marketing-footer";
import { StageNav } from "./marketing-nav";
import { PricingSection } from "./pricing";
import { ProofSignalCard } from "./proof-signal-card";
import { QualificationSection } from "./qualification";
import { Reveal } from "./reveal";
import { ResponsiveText } from "./responsive-text";
import { ScanForm } from "./scan-form";

export function MarketingHome({ accessState }: { accessState: HomepageAccessState }) {
  return (
    <div className="marketing-page">
      <div className="marketing-fold">
        <Hero accessState={accessState} />
        <EvidenceStrip />
      </div>
      <ProcessSection />
      <ProofSection />
      <QualificationSection />
      <BeyondSignals />
      <WhyWanterest />
      <CompetitorPreview />
      <DifferenceSection />
      <DailyValue />
      <PricingSection />
      <Faq />
      <FinalCta accessState={accessState} />
      <MarketingFooter />
    </div>
  );
}

const HERO_AVATARS = ["/avatars/avatar-01.png", "/avatars/avatar-02.png", "/avatars/avatar-03.png", "/avatars/avatar-04.png"] as const;

/**
 * Hero v2 (light) — docs: "Wanterest Hero v2.dc.html", sections 03/04. A rounded stone stage on
 * a white frame holds the nav, the pitch, the one-object CTA and a product window rising out of
 * a lime base glow. The CTA is the real state-aware access action.
 */
function Hero({ accessState }: { accessState: HomepageAccessState }) {
  return (
    <header className="marketing-hero-frame">
      <div className="marketing-hero-stage">
        <StageNav accessState={accessState} />
        <div className="marketing-hero-content">
          <div className="marketing-hero-badge">
            <span className="marketing-hero-badge-dot" aria-hidden="true" />
            <span>REAL DEMAND. FOUND.</span>
          </div>
          <h1 className="marketing-hero-headline">Know what buyers want next.</h1>
          <p className="marketing-hero-lede">Buying intent, unmet needs, and demand shifts — found in real public conversations.</p>
          <PrimaryAccessAction accessState={accessState} appearance="hero" />
          <p className="marketing-hero-evidence">Evidence attached to every finding. No manufactured activity.</p>
          {/* Audience fit, not endorsement: the avatars are illustrative (aria-hidden, empty alt) and
              the copy says who Wanterest is for — never that these people are customers. */}
          <div className="marketing-hero-audience">
            <div className="marketing-hero-avatars" aria-hidden="true">
              {HERO_AVATARS.map((src) => (
                <span className="marketing-hero-avatar" key={src}><Image src={src} alt="" width={30} height={30} sizes="30px" /></span>
              ))}
            </div>
            <p className="marketing-hero-audience-copy">
              <ResponsiveText
                full="Built for builders, marketers, and product teams who need the source behind every signal."
                short="For teams who need the source behind every signal."
              />
            </p>
          </div>
        </div>
        <HeroProductPreview />
      </div>
    </header>
  );
}

function PreviewSignalCard({ className = "" }: { className?: string }) {
  return (
    <div className={`marketing-preview-card${className}`}>
      <div className="marketing-preview-card-head">
        <span className="marketing-preview-tag is-ink"><span className="marketing-preview-tag-dot" />SIGNAL</span>
        <span className="marketing-preview-card-kind">Switching intent</span>
      </div>
      <p className="marketing-preview-card-title">Teams keep switching from X to Y because setup is faster.</p>
      <p className="marketing-preview-quote">“We moved over in an afternoon. The old tool took a quarter to configure.”</p>
      <div className="marketing-preview-card-foot"><strong>Source attached</strong><span>·</span><span>Observation window</span></div>
    </div>
  );
}

const PREVIEW_NAV = ["Home", "Signals", "Saved", "Insights", "Actions"] as const;

/**
 * Illustrative product window — example content (placeholder "Acme", "X to Y"), not real
 * customer data, counts or activity. Exposed to assistive tech as one labelled image.
 * Desktop/tablet: browser-framed Signals view. Mobile: the single Signal card.
 */
function HeroProductPreview() {
  return (
    <div className="marketing-hero-preview-slot" role="img" aria-label="Illustrative preview of the Wanterest Signals view with example Signal, Demand Gap and Demand Drift cards">
      <div className="marketing-hero-preview" aria-hidden="true">
        <div className="marketing-preview-chrome">
          <span /><span /><span />
          <div className="marketing-preview-url"><span>app.wanterest.com/signals</span></div>
          <span className="marketing-preview-chrome-spacer" />
        </div>
        <div className="marketing-preview-body">
          <div className="marketing-preview-sidebar">
            <div className="marketing-preview-workspace"><span className="marketing-preview-workspace-mark">A</span><span>Acme</span><span className="marketing-preview-workspace-caret">⌄</span></div>
            {PREVIEW_NAV.map((item) => (
              <div key={item} className={`marketing-preview-nav-item${item === "Signals" ? " is-active" : ""}`}><span className="marketing-preview-nav-icon" />{item}</div>
            ))}
          </div>
          <div className="marketing-preview-main">
            <div className="marketing-preview-main-head">
              <div className="marketing-preview-main-title"><strong>This week&apos;s demand</strong><span>Observation window · last 30 days</span></div>
              <div className="marketing-preview-segments"><span className="is-active">All</span><span>Signals</span><span>Demand Gap</span><span>Demand Drift</span></div>
            </div>
            <div className="marketing-preview-grid">
              <PreviewSignalCard />
              <div className="marketing-preview-card">
                <div className="marketing-preview-card-head">
                  <span className="marketing-preview-tag">DEMAND GAP</span>
                  <span className="marketing-preview-card-kind">Unmet need</span>
                </div>
                <p className="marketing-preview-card-title">Users want approval workflows without enterprise complexity.</p>
                <dl className="marketing-preview-gap">
                  <div><dt>Asked for</dt><dd className="is-strong">Lightweight approvals</dd></div>
                  <div><dt>Offered</dt><dd>Full enterprise suites</dd></div>
                </dl>
                <div className="marketing-preview-card-foot"><strong>Repeated unmet need</strong><span>·</span><span>Qualified demand</span></div>
              </div>
              <div className="marketing-preview-card">
                <div className="marketing-preview-card-head">
                  <span className="marketing-preview-tag">DEMAND DRIFT</span>
                  <span className="marketing-preview-card-kind">Trend movement</span>
                </div>
                <p className="marketing-preview-card-title">Mentions of AI note-taking are flattening while workflow automation rises.</p>
                <svg viewBox="0 0 280 44" width="100%" height="44" preserveAspectRatio="none" className="marketing-preview-drift">
                  <line x1="0" y1="43" x2="280" y2="43" stroke="rgba(17,17,16,0.08)" />
                  <polyline points="0,14 50,12 100,15 150,17 200,18 240,19 280,19" fill="none" stroke="#a3a399" strokeWidth="1.5" />
                  <polyline points="0,38 50,36 100,33 150,27 200,21 240,14 280,8" fill="none" stroke="#111110" strokeWidth="2" />
                  <circle cx="280" cy="8" r="3" fill="#D7FF3D" stroke="#111110" strokeWidth="1.2" />
                </svg>
                <div className="marketing-preview-card-foot"><strong>Changing demand</strong><span>·</span><span>Trend movement</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <PreviewSignalCard className=" is-mobile" />
    </div>
  );
}

const LISTENING_SOURCES = [
  { key: "reddit", label: "Reddit" },
  { key: "hacker-news", label: "Hacker News" },
  { key: "bluesky", label: "Bluesky" },
  { key: "x", label: "X" },
  { key: "github", label: "GitHub" },
] as const;

/** The logos that are true: the real public sources Wanterest reads — never a customer/logo strip. */
function EvidenceStrip() {
  return (
    <div className="marketing-logo-strip">
      <div className="marketing-logo-strip-inner">
        <div className="marketing-logo-strip-caption">WHERE WANTEREST LISTENS</div>
        <div className="marketing-logo-row">
          {LISTENING_SOURCES.map((source) => (
            <div className="marketing-source-strip-item" key={source.key}>
              <SourceBrandIcon sourceKey={source.key} size={22} decorative />
              <span>{source.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DocumentIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="var(--color-ink-secondary)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.5 8.5h5M5.5 11h3.5" stroke="var(--color-ink-secondary)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="8" width="3" height="6" rx="0.8" fill="var(--color-ink-secondary)" />
      <rect x="6.5" y="4.5" width="3" height="9.5" rx="0.8" fill="var(--color-ink-secondary)" />
      <rect x="11" y="1.5" width="3" height="12.5" rx="0.8" fill="var(--color-ink-secondary)" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="var(--color-accent)" aria-hidden="true">
      <path d="M8 1.5c.35 2.6 1.4 3.65 4 4a.15.15 0 0 1 0 .3c-2.6.35-3.65 1.4-4 4a.15.15 0 0 1-.3 0c-.35-2.6-1.4-3.65-4-4a.15.15 0 0 1 0-.3c2.6-.35 3.65-1.4 4-4a.15.15 0 0 1 .3 0Z" />
      <path d="M13 10.2c.18 1.3.7 1.83 2 2 .1.02.1.16 0 .18-1.3.17-1.82.7-2 2-.02.1-.16.1-.18 0-.17-1.3-.7-1.83-2-2a.1.1 0 0 1 0-.18c1.3-.17 1.83-.7 2-2 .02-.1.16-.1.18 0Z" />
    </svg>
  );
}

function UnderstandProof() {
  return (
    <article className="signal-card marketing-signal-static marketing-proof-signal-card">
      <div className="marketing-proof-signal-topline">
        <div className="marketing-proof-signal-source">
          <span className="marketing-proof-icon-chip"><DocumentIcon /></span>
          <span className="signal-source-name">Product context</span>
          <span className="marketing-proof-signal-separator" aria-hidden="true">·</span>
          <span className="signal-source-time">Workspace-provided</span>
        </div>
      </div>
      <span className="marketing-proof-signal-intent is-accent">Product context</span>
      <p className="marketing-proof-signal-quote">Product, audience, pains, and buyer language stay visible before a signal is interpreted.</p>
      <div className="marketing-proof-signal-tags">
        <span>Product</span>
        <span>Audience</span>
        <span>Pains</span>
        <span>Language</span>
      </div>
    </article>
  );
}

function FindProof() {
  return (
    <article className="signal-card marketing-signal-static marketing-proof-signal-card">
      <div className="marketing-proof-signal-topline">
        <div className="marketing-proof-signal-source">
          <SourceBrandIcon sourceKey="reddit" size={20} />
          <span className="signal-source-name">Reddit</span>
          <span className="marketing-proof-signal-separator" aria-hidden="true">·</span>
          <span className="signal-source-time">Observation date</span>
        </div>
          <span className="marketing-proof-signal-score">Source attached</span>
      </div>
      <span className="marketing-proof-signal-intent is-accent">Switching intent</span>
      <p className="marketing-proof-signal-quote">A public conversation can show switching context without becoming a claim about the whole market.</p>
      <div className="marketing-proof-signal-tags">
        <span>r/SaaS</span>
      </div>
    </article>
  );
}

function MapProof() {
  return (
    <article className="signal-card marketing-signal-static marketing-proof-signal-card">
      <div className="marketing-proof-signal-topline">
        <div className="marketing-proof-signal-source">
          <span className="marketing-proof-icon-chip"><BarsIcon /></span>
          <span className="signal-source-name">Demand intelligence</span>
        </div>
        <span className="marketing-proof-signal-score">Observed movement</span>
      </div>
      <span className="marketing-proof-signal-intent is-accent">Rising theme</span>
      <p className="marketing-proof-signal-quote">Themes and movement stay qualified by the evidence and observation window behind them.</p>
      <div className="marketing-proof-signal-tags">
        <span>Workflow simplicity</span>
        <span>HubSpot alternative demand</span>
      </div>
    </article>
  );
}

function ActProof() {
  return (
    <article className="signal-card marketing-signal-static marketing-proof-signal-card is-dark">
      <div className="marketing-proof-signal-topline">
        <div className="marketing-proof-signal-source">
          <span className="marketing-proof-icon-chip"><SparkleIcon /></span>
          <span className="signal-source-name">Recommended action</span>
        </div>
      </div>
      <span className="marketing-proof-signal-intent">Action</span>
      <p className="marketing-proof-signal-quote">Recommendations remain connected to the supporting evidence and are not presented as market facts.</p>
      <div className="marketing-proof-signal-tags">
        <span>Turn insight into impact →</span>
      </div>
    </article>
  );
}

const PROCESS_STEPS = [
  {
    key: "understand",
    number: "01",
    label: "UNDERSTAND",
    title: "Wanterest reads your product",
    body: "Maps your product, audience, pains, and buyer language.",
    proof: <UnderstandProof />,
  },
  {
    key: "find",
    number: "02",
    label: "FIND",
    title: "Finds qualified demand",
    body: "Finds real conversations with pain, intent, and switching signals.",
    proof: <FindProof />,
  },
  {
    key: "map",
    number: "03",
    label: "MAP",
    title: "Turns demand into intelligence",
    body: "Groups signals into themes, gaps, movement, and competitive context.",
    proof: <MapProof />,
  },
  {
    key: "act",
    number: "04",
    label: "ACT",
    title: "Recommends the next move",
    body: "Turns market demand into clear actions for product, positioning, and growth.",
    proof: <ActProof />,
  },
];

function ProcessSection() {
  return (
    <section className="marketing-section marketing-process-section is-tight is-alt" id="how-it-works">
      <div className="marketing-section-inner marketing-process-inner">
        <div className="marketing-section-eyebrow">THE PROCESS</div>
        <h2 className="marketing-heading marketing-section-title is-tight">From product to demand in minutes.</h2>
        <p className="marketing-section-subtitle">
          <ResponsiveText
            full="Wanterest turns product context into real market demand, clear intelligence, and the next move to make."
            short="Wanterest turns product context into real market demand and clear intelligence."
          />
        </p>
        <div className="marketing-proof-strip">
          {PROCESS_STEPS.map((step, index) => (
            <Reveal key={step.key} delay={index * 80}>
              <div className="marketing-proof-step">
                <div className="marketing-process-node-row">
                  <span className="marketing-process-node">{step.number}</span>
                  {index < PROCESS_STEPS.length - 1 ? (
                    <>
                      <span className="marketing-process-node-line" aria-hidden="true" />
                      <span className="marketing-process-node-arrow" aria-hidden="true">→</span>
                    </>
                  ) : null}
                </div>
                <div className="marketing-proof-eyebrow">{step.label}</div>
                <div className="marketing-proof-title">{step.title}</div>
                <p className="marketing-proof-body">{step.body}</p>
                {step.proof}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofSection() {
  return (
    <section className="marketing-section is-tight" id="examples">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">SIGNAL, NOT NOISE</div>
        <h2 className="marketing-heading marketing-section-title marketing-proof-section-title is-tight">See why a conversation matters before you open it.</h2>
        <p className="marketing-section-subtitle">
          <ResponsiveText
            full="Wanterest finds public conversations, qualifies the intent, and shows why they matter."
            short="Wanterest finds public conversations and qualifies the intent."
          />
        </p>

        <div className="marketing-proof-signal-grid">
          <ProofSignalCard
            source="x"
            sourceLabel="X"
            time="Observation date"
            intentLabel="Switching intent"
            intentTone="accent"
            evidenceLabel="Source attached"
            quote="A public conversation can show switching context without becoming a claim about the whole market."
            tags={["Qualification"]}
            iconSize={28}
          />
          <ProofSignalCard
            source="reddit"
            sourceLabel="Reddit"
            time="Observation date"
            intentLabel="High intent"
            intentTone="accent"
            evidenceLabel="Observation"
            quote="The observation, source and temporal context stay visible before an interpretation is made."
            tags={["Source context"]}
            iconSize={28}
          />
          <ProofSignalCard
            source="hacker-news"
            sourceLabel="Hacker News"
            time="Observation date"
            intentLabel="Problem signal"
            intentTone="problem"
            evidenceLabel="Qualified context"
            quote="Wanterest preserves uncertainty when an individual problem signal does not support a broader conclusion."
            tags={["Evidence fidelity"]}
            iconSize={28}
          />
        </div>
      </div>
    </section>
  );
}

function BeyondSignals() {
  return (
    <section className="marketing-section is-tight">
      <div className="marketing-section-inner marketing-section-wide" style={{ textAlign: "center" }}>
        <div className="marketing-section-eyebrow">BEYOND SIGNALS</div>
        <h2 className="marketing-heading marketing-section-title">Understand demand. Then act on it.</h2>
        <p className="marketing-section-copy marketing-beyond-copy">
          <ResponsiveText
            full="See what your market wants, where you're missing it, what's changing, and what to do next."
            short="See what your market wants, where you're missing it, and what's changing."
          />
        </p>
      </div>
      <div className="marketing-beyond-visual">
        <BeyondSignalsTabs />
      </div>
    </section>
  );
}

function WhyWanterest() {
  const features = [
    { title: "Real evidence", body: "Every Signal links back to the original conversation." },
    { title: "Qualified intent", body: "Noise, promotion and generic mentions are filtered out." },
    { title: "Market context", body: "Individual Signals become themes, gaps and trends." },
    { title: "Actionable", body: "Every recommendation is connected to supporting evidence." },
  ];
  return (
    <section className="marketing-section is-tight is-alt">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">WHY WANTEREST</div>
        <h2 className="marketing-heading marketing-section-title marketing-section-title-compact is-tight">Built for evidence, not guesses.</h2>
        <div className="marketing-feature-grid">
          {features.map((feature) => (
            <div className="marketing-feature-card" key={feature.title}>
              <div className="marketing-feature-title">{feature.title}</div>
              <div className="marketing-feature-body">{feature.body}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CompetitorPreview() {
  return (
    <section className="marketing-section is-tight">
      <div className="marketing-section-inner marketing-competitor-inner">
        <div className="marketing-section-eyebrow">COMING SOON</div>
        <h2 className="marketing-heading marketing-section-title marketing-competitor-title">Understand the context around demand.</h2>
        <p className="marketing-section-subtitle marketing-competitor-subtitle">
          <ResponsiveText
            full="See how buyer language, alternatives and unmet needs can be organized without turning a small sample into a market-wide claim."
            short="Keep buyer context and uncertainty visible."
          />
        </p>
        <div className="marketing-competitor-card">
          <div className="marketing-competitor-kicker"><BarsIcon /> <span>Context intelligence</span></div>

          <div className="marketing-competitor-products">
            <div className="marketing-competitor-product is-you">
              <span className="marketing-competitor-dot" />
              <div>
                <strong>Observed language</strong>
                <span>What people actually describe</span>
              </div>
            </div>
            <div className="marketing-competitor-vs" aria-hidden="true">+</div>
            <div className="marketing-competitor-product is-them">
              <span className="marketing-competitor-dot" />
              <div>
                <strong>Market context</strong>
                <span>What the evidence can support</span>
              </div>
            </div>
          </div>

          <div className="marketing-competitor-metrics">
            {[
              ["Observation", "The original conversation and source remain attached."],
              ["Interpretation", "Themes, gaps and movement are clearly labeled as derived."],
              ["Uncertainty", "Unsupported percentages and market-wide claims stay out."],
            ].map(([title, body]) => (
              <div className="marketing-competitor-metric" key={title}>
                <div className="marketing-competitor-metric-copy">
                  <strong>{title}</strong>
                  <span>{body}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="marketing-competitor-callout">
            <span className="marketing-competitor-callout-icon"><LightbulbIcon /></span>
            <p><strong>Evidence before inference.</strong><span>Wanterest keeps the claim no stronger than the source behind it.</span></p>
          </div>
        </div>
      </div>
    </section>
  );
}

function LightbulbIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18h6M10 21h4M8.6 14.7a6 6 0 1 1 6.8 0c-.9.7-1.4 1.4-1.4 2.3h-4c0-.9-.5-1.6-1.4-2.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DAILY_FEED = [
  {
    key: "d1",
    source: "reddit",
    label: "Source reference",
    time: "Observation date",
    quote: "Every signal keeps its original source and observation context attached.",
    tag: "Provenance",
  },
  {
    key: "d2",
    source: "hacker-news",
    label: "Qualification",
    time: "Lifecycle state",
    quote: "Qualification and lifecycle state stay visible as the finding changes.",
    tag: "Evidence",
    tone: "problem",
  },
  {
    key: "d3",
    source: "bluesky",
    label: "Derived context",
    time: "Bounded window",
    quote: "Themes and movement are bounded by the evidence and time window behind them.",
    tag: "Freshness",
  },
  {
    key: "d4",
    source: "x",
    label: "Uncertainty",
    time: "Always visible",
    quote: "A small set of conversations never becomes an unsupported market-wide claim.",
    tag: "Caution",
  },
] as const;

function DailyValue() {
  return (
    <section className="marketing-section is-tight">
      <div className="marketing-daily-inner">
        <div className="marketing-section-eyebrow">DAILY VALUE</div>
        <h2 className="marketing-heading marketing-section-title marketing-section-title-compact">A clearer market picture, over time.</h2>
        <p className="marketing-section-subtitle marketing-daily-subtitle">
          <ResponsiveText
            full="Wanterest keeps the source, qualification and freshness of each finding visible as your market changes."
            short="Keep source, qualification and freshness visible."
          />
        </p>
        <div className="marketing-daily-card">
          <div className="marketing-daily-card-head">
            <div>
              <div className="marketing-daily-card-label">Illustrative intelligence view</div>
              <div className="marketing-daily-card-headline">Findings, with their context attached.</div>
            </div>
            <div className="marketing-daily-live">
              <span className="marketing-daily-pulse-dot" aria-hidden="true" />
              Source-linked
            </div>
          </div>
          <div className="marketing-daily-stats">
            <div className="marketing-daily-stat">
              <strong>Source</strong>
              <span>linked to the finding</span>
            </div>
            <div className="marketing-daily-stat">
              <strong>Time</strong>
              <span>bounded observation window</span>
            </div>
            <div className="marketing-daily-stat">
              <strong>Context</strong>
              <span>qualification stays visible</span>
            </div>
          </div>
          <div className="marketing-daily-feed">
            {DAILY_FEED.map((item, index) => (
              <Reveal key={item.key} delay={index * 90}>
                <div className="marketing-daily-feed-row">
                  <SourceBrandIcon sourceKey={item.source} label={item.label} size={22} />
                  <div className="marketing-daily-feed-body">
                    <p>&ldquo;{item.quote}&rdquo;</p>
                    <span className="marketing-daily-feed-meta">{item.label} · {item.time}</span>
                  </div>
                  <span className={`marketing-daily-feed-tag${"tone" in item && item.tone === "problem" ? " is-problem" : ""}`}>{item.tag}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <a className="marketing-cta is-compact" href={APP_START_URL}>See the product →</a>
      </div>
    </section>
  );
}

function FinalCta({ accessState }: { accessState: HomepageAccessState }) {
  return (
    <section className="marketing-section is-tight marketing-final-cta is-dark">
      <div className="marketing-final-cta-glow" aria-hidden="true" />
      <h2 className="marketing-heading marketing-section-title marketing-section-title-compact marketing-final-cta-title">The demand is already there.</h2>
      <p className="marketing-final-cta-sub">Find it.</p>
      <PrimaryAccessAction accessState={accessState} compact />
    </section>
  );
}

function PrimaryAccessAction({ accessState, compact = false, appearance = "default" }: { accessState: HomepageAccessState; compact?: boolean; appearance?: "default" | "hero" }) {
  if (accessState.primaryAction === "START_FREE") return <ScanForm compact={compact} ctaVariant={compact ? "accent" : "ink"} variant="scan" appearance={appearance} />;
  if (accessState.primaryAction === "REQUEST_ACCESS") return <ScanForm compact={compact} ctaVariant={compact ? "accent" : "ink"} variant="request" appearance={appearance} />;
  const href = `${APP_ORIGIN}${accessState.primaryActionHref}`;
  const label = {
    REQUEST_ACCESS: "Request access",
    CHECK_EMAIL: "Check your email",
    VIEW_STATUS: "View status",
    VIEW_PRIORITY_STATUS: "View Priority status",
    ACCEPT_INVITATION: "Accept invitation",
    OPEN_WANTEREST: "Open Wanterest",
  }[accessState.primaryAction];
  if (appearance === "hero") return <a className="marketing-hero-submit is-standalone" href={href}>{label}<span className="marketing-hero-arrow" aria-hidden="true">→</span></a>;
  return <a className={`marketing-cta${compact ? " is-compact" : ""}${compact ? " is-accent" : ""}`} href={href}>{label} →</a>;
}
