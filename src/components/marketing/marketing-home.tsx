import Image from "next/image";
import type { CSSProperties } from "react";

import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { BeyondSignalsTabs } from "./beyond-signals";
import { DifferenceSection } from "./difference";
import { Faq } from "./faq";
import { HeroWave } from "./hero-wave";
import { APP_START_URL } from "./links";
import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";
import { PricingSection } from "./pricing";
import { ProofSignalCard } from "./proof-signal-card";
import { QualificationSection } from "./qualification";
import { Reveal } from "./reveal";
import { ResponsiveText } from "./responsive-text";
import { ScanForm } from "./scan-form";

export function MarketingHome() {
  return (
    <div className="marketing-page">
      <MarketingNav />
      <div className="marketing-fold">
        <Hero />
        <LogoStrip />
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
      <FinalCta />
      <MarketingFooter />
    </div>
  );
}

/**
 * Hand-authored, not randomized: fixed positions/timings keep server and client markup
 * identical (no hydration mismatch) and keep the field intentional rather than noisy.
 * Each dot sits in the left/right margins of the hero, never behind the centered copy column.
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
  desktopOnly?: boolean;
};

const SIGNAL_DOTS: SignalDot[] = [
  // Visible at every width — pinned to the far corners/margins, clear of stacked mobile content.
  { x: 6, y: 8, size: 5, tone: "neutral", dx: 4, dy: -3, delay: 0, duration: 13 },
  { x: 92, y: 10, size: 6, tone: "accent", dx: -4, dy: 3, delay: 2, duration: 15 },
  { x: 8, y: 88, size: 4, tone: "accent", dx: 3, dy: -4, delay: 1, duration: 14 },
  { x: 90, y: 90, size: 5, tone: "neutral", dx: -3, dy: 4, delay: 3, duration: 12 },
  { x: 4, y: 45, size: 4, tone: "neutral", dx: 4, dy: 4, delay: 1.6, duration: 16 },
  { x: 95, y: 48, size: 5, tone: "accent", dx: -4, dy: -4, delay: 2.6, duration: 15 },
  // Desktop only (≥1024px) — fills out the side margins once there's room beside the column.
  { x: 14, y: 18, size: 6, tone: "accent", dx: 6, dy: -8, delay: 0.4, duration: 11, desktopOnly: true },
  { x: 20, y: 30, size: 5, tone: "neutral", dx: -6, dy: 7, delay: 1.8, duration: 13, desktopOnly: true },
  { x: 12, y: 42, size: 8, tone: "accent", dx: 6, dy: 9, delay: 2.4, duration: 10, desktopOnly: true },
  { x: 22, y: 60, size: 4, tone: "neutral", dx: -7, dy: -6, delay: 0.8, duration: 14, desktopOnly: true },
  { x: 16, y: 74, size: 7, tone: "accent", dx: 5, dy: -8, delay: 3.2, duration: 12, desktopOnly: true },
  { x: 84, y: 18, size: 5, tone: "neutral", dx: -6, dy: -7, delay: 1.2, duration: 13, desktopOnly: true },
  { x: 79, y: 30, size: 6, tone: "accent", dx: 7, dy: 6, delay: 2.8, duration: 11, desktopOnly: true },
  { x: 87, y: 44, size: 4, tone: "neutral", dx: -5, dy: 8, delay: 0.6, duration: 15, desktopOnly: true },
  { x: 80, y: 62, size: 9, tone: "accent", dx: 6, dy: -9, delay: 2, duration: 10, desktopOnly: true },
  { x: 85, y: 76, size: 5, tone: "neutral", dx: -6, dy: 6, delay: 3.4, duration: 13, desktopOnly: true },
];

/** Quiet drifting points standing in for individual demand signals — replaces reliance on a single glow. */
function HeroSignalField() {
  return (
    <div className="marketing-hero-signal-field" aria-hidden="true">
      {SIGNAL_DOTS.map((dot, index) => (
        <span
          key={index}
          className={`marketing-hero-dot is-${dot.tone}${dot.desktopOnly ? " is-desktop-only" : ""}`}
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

function Hero() {
  return (
    <header className="marketing-hero">
      <div className="marketing-hero-bg" aria-hidden="true" />
      <HeroSignalField />
      <div className="marketing-hero-sides" aria-hidden="true">
        <div className="marketing-hero-side is-left">
          <span>
            REAL
            <br />
            PEOPLE.
          </span>
          <i />
        </div>
        <div className="marketing-hero-side is-right">
          <i />
          <span>
            REAL
            <br />
            DEMAND.
          </span>
        </div>
      </div>
      <div className="marketing-hero-inner">
        <div className="marketing-eyebrow-pill">
          <span className="marketing-eyebrow-pill-dot" />
          <span className="marketing-eyebrow-pill-text">REAL DEMAND. FOUND.</span>
        </div>
        <h1 className="marketing-display-title marketing-hero-title">
          {"The demand "}
          <br className="marketing-hero-title-break" />
          already exists.
        </h1>
        <p className="marketing-hero-sub">Wanterest just finds it.</p>
        <ScanForm />
        <p className="marketing-hero-note">No keywords. No setup. Just real conversations.</p>
        <div className="marketing-hero-proof-row">
          <div className="marketing-hero-avatars" aria-hidden="true">
            <span className="marketing-hero-avatar">
              <Image src="/avatars/avatar-01.png" alt="" width={36} height={36} />
            </span>
            <span className="marketing-hero-avatar">
              <Image src="/avatars/avatar-02.png" alt="" width={36} height={36} />
            </span>
            <span className="marketing-hero-avatar">
              <Image src="/avatars/avatar-03.png" alt="" width={36} height={36} />
            </span>
            <span className="marketing-hero-avatar">
              <Image src="/avatars/avatar-04.png" alt="" width={36} height={36} />
            </span>
          </div>
          <span className="marketing-hero-proof-divider" aria-hidden="true" />
          <p className="marketing-hero-proof">Built for builders, marketers and product teams finding what customers actually want.</p>
        </div>
      </div>
      <HeroWave />
    </header>
  );
}

function LogoStrip() {
  return (
    <div className="marketing-logo-strip">
      <div className="marketing-logo-strip-inner">
        <div className="marketing-logo-strip-caption">REAL CONVERSATIONS. REAL OPPORTUNITIES.</div>
        <div className="marketing-logo-row">
          <div className="marketing-logo-mark">stripe</div>
          <div className="marketing-logo-mark">
            <span className="marketing-logo-mark-box">N</span>Notion
          </div>
          <div className="marketing-logo-mark">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="4" cy="4" r="3" fill="currentColor" />
              <circle cx="12" cy="4" r="3" fill="currentColor" />
              <circle cx="4" cy="12" r="3" fill="currentColor" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
            Figma
          </div>
          <div className="marketing-logo-mark">
            <span className="marketing-logo-mark-fill">🛍</span>shopify
          </div>
          <div className="marketing-logo-mark">
            <span className="marketing-logo-mark-dot" />Linear
          </div>
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
          <span className="signal-source-name">Acme</span>
          <span className="marketing-proof-signal-separator" aria-hidden="true">·</span>
          <span className="signal-source-time">B2B SaaS</span>
        </div>
      </div>
      <span className="marketing-proof-signal-intent is-accent">Product context</span>
      <p className="marketing-proof-signal-quote">&ldquo;Helps growing teams automate repetitive work with a simple, flexible workflow builder.&rdquo;</p>
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
          <span className="signal-source-time">2d ago</span>
        </div>
        <span className="marketing-proof-signal-score">94% match</span>
      </div>
      <span className="marketing-proof-signal-intent is-accent">Switching intent</span>
      <p className="marketing-proof-signal-quote">&ldquo;We&rsquo;re paying for half of HubSpot we never use. Has anyone moved to something simpler?&rdquo;</p>
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
        <span className="marketing-proof-signal-score">↑ 31%</span>
      </div>
      <span className="marketing-proof-signal-intent is-accent">Rising theme</span>
      <p className="marketing-proof-signal-quote">&ldquo;Growing frustration with complexity and pricing across SMB teams.&rdquo;</p>
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
      <p className="marketing-proof-signal-quote">&ldquo;Make simplicity explicit in homepage positioning.&rdquo;</p>
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
            time="2h ago"
            intentLabel="Switching intent"
            intentTone="accent"
            matchPercent={84}
            quote="Looking for a simpler alternative to HubSpot. The setup feels overwhelming for our small team."
            tags={["CRM tools"]}
            iconSize={28}
          />
          <ProofSignalCard
            source="reddit"
            sourceLabel="Reddit"
            time="7h ago"
            intentLabel="High intent"
            intentTone="accent"
            matchPercent={88}
            quote="Looking for a tool that can watch our inbox and CRM together. Recommendations?"
            tags={["CRM sync"]}
            iconSize={28}
          />
          <ProofSignalCard
            source="hacker-news"
            sourceLabel="Hacker News"
            time="1h ago"
            intentLabel="Problem signal"
            intentTone="problem"
            matchPercent={81}
            quote="Every week I reconcile the same invoices across three spreadsheets by hand."
            tags={["Operations"]}
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
        <h2 className="marketing-heading marketing-section-title marketing-competitor-title">Understand what buyers compare you against.</h2>
        <p className="marketing-section-subtitle marketing-competitor-subtitle">
          <ResponsiveText
            full="See which alternatives buyers actually consider, and where neither product owns the demand."
            short="See which alternatives buyers actually consider."
          />
        </p>
        <div className="marketing-competitor-card">
          <div className="marketing-competitor-kicker"><BarsIcon /> <span>Comparison intelligence</span></div>

          <div className="marketing-competitor-products">
            <div className="marketing-competitor-product is-you">
              <span className="marketing-competitor-dot" />
              <div>
                <strong>Your product</strong>
                <span>Share of buyer conversations</span>
              </div>
            </div>
            <div className="marketing-competitor-vs" aria-hidden="true">VS</div>
            <div className="marketing-competitor-product is-them">
              <span className="marketing-competitor-dot" />
              <div>
                <strong>Competitor</strong>
                <span>Share of buyer conversations</span>
              </div>
            </div>
          </div>

          <div className="marketing-competitor-metrics">
            <div className="marketing-competitor-metric">
              <div className="marketing-competitor-side-stat is-you">
                <strong>58%</strong>
                <span className="marketing-competitor-bar"><span style={{ width: "58%" }} /></span>
              </div>
              <div className="marketing-competitor-metric-copy">
                <strong>Demand overlap</strong>
                <span>Share of conversations where both products are considered.</span>
                <em>Competitor +13 pts</em>
              </div>
              <div className="marketing-competitor-side-stat is-them">
                <strong>71%</strong>
                <span className="marketing-competitor-bar"><span style={{ width: "71%" }} /></span>
              </div>
            </div>

            <div className="marketing-competitor-metric">
              <div className="marketing-competitor-side-stat is-you">
                <strong>44%</strong>
                <span className="marketing-competitor-bar"><span style={{ width: "44%" }} /></span>
              </div>
              <div className="marketing-competitor-metric-copy">
                <strong>Positioning strength</strong>
                <span>Share of conversations where your product is the clear preference.</span>
                <em>Competitor +8 pts</em>
              </div>
              <div className="marketing-competitor-side-stat is-them">
                <strong>52%</strong>
                <span className="marketing-competitor-bar"><span style={{ width: "52%" }} /></span>
              </div>
            </div>

            <div className="marketing-competitor-metric">
              <div className="marketing-competitor-side-stat is-you">
                <strong>27%</strong>
                <span className="marketing-competitor-bar"><span style={{ width: "27%" }} /></span>
              </div>
              <div className="marketing-competitor-metric-copy">
                <strong>Unmet demand</strong>
                <span>Share of conversations that mention neither product.</span>
                <em className="is-neutral">Open opportunity</em>
              </div>
              <div className="marketing-competitor-side-stat is-them">
                <strong>27%</strong>
                <span className="marketing-competitor-bar"><span style={{ width: "27%" }} /></span>
              </div>
            </div>
          </div>

          <div className="marketing-competitor-callout">
            <span className="marketing-competitor-callout-icon"><LightbulbIcon /></span>
            <p><strong>27% of conversations mention neither product.</strong><span>Open demand for whoever claims it first.</span></p>
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
    label: "Reddit",
    time: "9m ago",
    quote: "Anyone found a lightweight HubSpot alternative that doesn’t nickel-and-dime you?",
    tag: "Switching intent",
  },
  {
    key: "d2",
    source: "hacker-news",
    label: "Hacker News",
    time: "24m ago",
    quote: "We ended up building our own CRM because nothing fit our workflow.",
    tag: "Problem signal",
    tone: "problem",
  },
  {
    key: "d3",
    source: "bluesky",
    label: "Bluesky",
    time: "1h ago",
    quote: "Paying for a dozen features we never touch. There has to be something simpler.",
    tag: "High intent",
  },
  {
    key: "d4",
    source: "x",
    label: "X",
    time: "2h ago",
    quote: "Need a CRM that just works out of the box. Recommendations welcome.",
    tag: "Switching intent",
  },
] as const;

function DailyValue() {
  return (
    <section className="marketing-section is-tight">
      <div className="marketing-daily-inner">
        <div className="marketing-section-eyebrow">DAILY VALUE</div>
        <h2 className="marketing-heading marketing-section-title marketing-section-title-compact">Wake up to new opportunities.</h2>
        <p className="marketing-section-subtitle marketing-daily-subtitle">
          <ResponsiveText
            full="Wanterest keeps monitoring your market and surfaces new demand as it appears."
            short="Wanterest keeps monitoring your market for new demand."
          />
        </p>
        <div className="marketing-daily-card">
          <div className="marketing-daily-card-head">
            <div>
              <div className="marketing-daily-card-label">Representative daily digest</div>
              <div className="marketing-daily-card-headline">New demand, sorted for you.</div>
            </div>
            <div className="marketing-daily-live">
              <span className="marketing-daily-pulse-dot" aria-hidden="true" />
              Monitoring live
            </div>
          </div>
          <div className="marketing-daily-stats">
            <div className="marketing-daily-stat">
              <strong>7</strong>
              <span>new opportunities</span>
            </div>
            <div className="marketing-daily-stat">
              <strong>2</strong>
              <span>switching signals</span>
            </div>
            <div className="marketing-daily-stat">
              <strong>1</strong>
              <span>rising demand theme</span>
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
        <a className="marketing-cta is-compact" href={APP_START_URL}>See today&rsquo;s signals →</a>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="marketing-section is-tight marketing-final-cta is-dark">
      <div className="marketing-final-cta-glow" aria-hidden="true" />
      <h2 className="marketing-heading marketing-section-title marketing-section-title-compact marketing-final-cta-title">The demand is already there.</h2>
      <p className="marketing-final-cta-sub">Find it.</p>
      <ScanForm compact ctaVariant="accent" />
    </section>
  );
}
