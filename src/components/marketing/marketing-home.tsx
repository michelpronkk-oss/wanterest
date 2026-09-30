import Image from "next/image";

import type { HomepageAccessState } from "@/server/modules/access";
import { APP_ORIGIN } from "@/shared/config/site";
import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { BeyondSignalsTabs } from "./beyond-signals";
import { ComparisonPreviewSection } from "./comparison-preview";
import { DailyValueSection } from "./daily-value";
import { DifferenceSection } from "./difference";
import { Faq } from "./faq";
import { HeroDashboardPreview } from "./hero-dashboard-preview";
import { MarketingFooter } from "./marketing-footer";
import { SiteNav } from "./marketing-nav";
import { PricingSection } from "./pricing";
import { ProofSignalCard } from "./proof-signal-card";
import { QualificationSection } from "./qualification";
import { Reveal } from "./reveal";
import { ResponsiveText } from "./responsive-text";
import { ScanForm } from "./scan-form";
import { WhyWanterestSection } from "./why-wanterest";

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
      <WhyWanterestSection />
      <DailyValueSection />
      <ComparisonPreviewSection />
      <DifferenceSection />
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
        <SiteNav accessState={accessState} />
        <div className="marketing-hero-content">
          <div className="marketing-hero-badge">
            <span className="marketing-hero-badge-dot" aria-hidden="true" />
            <span>REAL DEMAND. FOUND.</span>
          </div>
          <h1 className="marketing-hero-headline">Know what buyers want next.</h1>
          <p className="marketing-hero-lede">Buying intent, unmet needs, and demand shifts, found in real public conversations.</p>
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
        <div className="marketing-hero-preview-group">
          <HeroDashboardPreview />
        </div>
      </div>
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
