import Image from "next/image";
import type { CSSProperties } from "react";

import type { HomepageAccessState } from "@/server/modules/access";
import { APP_ORIGIN } from "@/shared/config/site";
import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { BeyondSignalsTabs } from "./beyond-signals";
import { DifferenceSection } from "./difference";
import { Faq } from "./faq";
import { HeroWave } from "./hero-wave";
import { APP_START_URL } from "./links";
import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";
import { PricingSection } from "./pricing";
import { BarsIcon, DocumentIcon, SparkleIcon } from "./proof-icons";
import { ProofSignalCard } from "./proof-signal-card";
import { QualificationSection } from "./qualification";
import { Reveal } from "./reveal";
import { ResponsiveText } from "./responsive-text";
import { ScanForm } from "./scan-form";

export function MarketingHome({ accessState }: { accessState: HomepageAccessState }) {
  return (
    <div className="marketing-page">
      <MarketingNav accessState={accessState} />
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

/**
 * Hand-authored, not randomized: fixed positions/timings keep server and client markup
 * identical (no hydration mismatch) and keep the field intentional rather than noisy.
 * Each dot sits in the left/right margins of the hero, never behind the centered copy column.
 * Six dots, two lime-tinted: this field marks an unrecognized visitor, so it never shows once
 * someone is already known (submitted, verified, invited, or a member) — see its render site.
 */
type SignalDot = {
  x: number;
  y: number;
  size: number;
  tone: "accent" | "neutral";
  dx: number;
  dy: number;
  delay: number;
  duration: number;
};

const SIGNAL_DOTS: SignalDot[] = [
  { x: 6, y: 8, size: 5, tone: "neutral", dx: 4, dy: -3, delay: 0, duration: 13 },
  { x: 92, y: 10, size: 6, tone: "accent", dx: -4, dy: 3, delay: 2, duration: 15 },
  { x: 8, y: 88, size: 4, tone: "accent", dx: 3, dy: -4, delay: 1, duration: 14 },
  { x: 90, y: 90, size: 5, tone: "neutral", dx: -3, dy: 4, delay: 3, duration: 12 },
  { x: 4, y: 45, size: 4, tone: "neutral", dx: 4, dy: 4, delay: 1.6, duration: 16 },
  { x: 95, y: 48, size: 5, tone: "neutral", dx: -4, dy: -4, delay: 2.6, duration: 15 },
];

/** Quiet drifting points standing in for individual demand signals — replaces reliance on a single glow. */
function HeroSignalField() {
  return (
    <div className="marketing-hero-signal-field" aria-hidden="true">
      {SIGNAL_DOTS.map((dot, index) => (
        <span
          key={index}
          className={`marketing-hero-dot is-${dot.tone}`}
          style={
            {
              left: `${dot.x}%`,
              top: `${dot.y}%`,
              width: dot.size,
              height: dot.size,
              animationDelay: `${dot.delay}s`,
              animationDuration: `${dot.duration}s`,
              "--dot-dx": `${dot.dx}px`,
              "--dot-dy": `${dot.dy}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** True only for a visitor nobody has a record of yet — the state the signal-dot field marks. */
function isUnrecognizedVisitor(accessState: HomepageAccessState): boolean {
  return accessState.primaryAction === "REQUEST_ACCESS" || accessState.primaryAction === "START_FREE";
}

function Hero({ accessState }: { accessState: HomepageAccessState }) {
  return (
    <header className="marketing-hero">
      <div className="marketing-hero-bg" aria-hidden="true" />
      {isUnrecognizedVisitor(accessState) ? <HeroSignalField /> : null}
      <div className="marketing-hero-inner">
        <div className="marketing-eyebrow-pill">
          <span className="marketing-eyebrow-pill-dot" />
          <span className="marketing-eyebrow-pill-text">REAL DEMAND. FOUND.</span>
        </div>
        <h1 className="marketing-display-title marketing-hero-title">
          {"Know what your market "}
          <br className="marketing-hero-title-break" />
          wants next.
        </h1>
        <p className="marketing-hero-sub">
          <ResponsiveText
            full="Wanterest finds buying intent, unmet needs and demand shifts in real public conversations, with the evidence attached."
            short="Buying intent, unmet needs and demand shifts, found in real public conversations."
          />
        </p>
        <PrimaryAccessAction accessState={accessState} />
        <p className="marketing-hero-note">Evidence attached to every finding. No manufactured activity.</p>
        {/* Illustrative avatars, not customer photos — aria-hidden, and the claim below is a
            "who this is for" statement, never "these are our users." */}
        <div className="marketing-hero-proof-row">
          <div className="marketing-hero-avatars" aria-hidden="true">
            <span className="marketing-hero-avatar"><Image src="/avatars/avatar-01.png" alt="" width={36} height={36} /></span>
            <span className="marketing-hero-avatar"><Image src="/avatars/avatar-02.png" alt="" width={36} height={36} /></span>
            <span className="marketing-hero-avatar"><Image src="/avatars/avatar-03.png" alt="" width={36} height={36} /></span>
            <span className="marketing-hero-avatar"><Image src="/avatars/avatar-04.png" alt="" width={36} height={36} /></span>
          </div>
          <span className="marketing-hero-proof-divider" aria-hidden="true" />
          <p className="marketing-hero-proof">Built for builders, marketers, and product teams who need the evidence behind every signal.</p>
        </div>
      </div>
      <HeroWave />
    </header>
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

/**
 * A deliberately plain placeholder, not a mocked-up asset: this feature's real visual is being
 * designed separately. The dashed border reads as "in progress," never as a finished preview.
 */
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
        <div className="marketing-coming-soon-placeholder">
          <span className="marketing-coming-soon-placeholder-icon"><BarsIcon /></span>
          <p>Context intelligence is in development. This preview will show buyer language, alternatives, and unmet needs once it ships.</p>
        </div>
      </div>
    </section>
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

function PrimaryAccessAction({ accessState, compact = false }: { accessState: HomepageAccessState; compact?: boolean }) {
  if (accessState.primaryAction === "START_FREE") return <ScanForm compact={compact} ctaVariant={compact ? "accent" : "ink"} variant="scan" />;
  if (accessState.primaryAction === "REQUEST_ACCESS") return <ScanForm compact={compact} ctaVariant={compact ? "accent" : "ink"} variant="request" />;
  const href = `${APP_ORIGIN}${accessState.primaryActionHref}`;
  const label = {
    REQUEST_ACCESS: "Request access",
    CHECK_EMAIL: "Check your email",
    VIEW_STATUS: "View status",
    VIEW_PRIORITY_STATUS: "View Priority status",
    ACCEPT_INVITATION: "Accept invitation",
    OPEN_WANTEREST: "Open Wanterest",
  }[accessState.primaryAction];
  return <a className={`marketing-cta${compact ? " is-compact" : ""}${compact ? " is-accent" : ""}`} href={href}>{label} →</a>;
}
