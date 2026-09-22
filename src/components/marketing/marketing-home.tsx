import Link from "next/link";

import { LogoMark } from "@/components/dashboard/nav-icons";
import { BeyondSignalsTabs } from "./beyond-signals";
import { HeroWave } from "./hero-wave";
import { APP_LOGIN_URL, APP_SIGNUP_URL } from "./links";
import { PricingSection } from "./pricing";
import { ProofSignalCard } from "./proof-signal-card";
import { Reveal } from "./reveal";
import { ScanForm } from "./scan-form";

/** Renders the full desktop copy, swapped via CSS for a shorter mobile variant at narrow widths. */
function ResponsiveText({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="marketing-copy-full">{full}</span>
      <span className="marketing-copy-short">{short}</span>
    </>
  );
}

export function MarketingHome() {
  return (
    <div className="marketing-page">
      <MarketingNav />
      <Hero />
      <ProductProofStrip />
      <HowItWorks />
      <SignalTypes />
      <ProofSection />
      <Qualification />
      <BeyondSignals />
      <WhyWanterest />
      <CompetitorPreview />
      <Positioning />
      <DailyValue />
      <PricingSection />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}

function MarketingNav() {
  return (
    <nav className="marketing-nav">
      <div className="marketing-nav-inner">
        <Link href="/" className="marketing-logo">
          <LogoMark size={20} />
          <span className="marketing-logo-text">wanterest</span>
        </Link>
        <div className="marketing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#examples">Examples</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="marketing-nav-actions">
          <a className="marketing-nav-signin" href={APP_LOGIN_URL}>Log in</a>
          <a className="marketing-cta-nav" href={APP_SIGNUP_URL}>Start free</a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="marketing-hero">
      <div className="marketing-eyebrow-pill">
        <span className="marketing-eyebrow-pill-dot" />
        <span className="marketing-eyebrow-pill-text">REAL DEMAND. FOUND.</span>
      </div>
      <h1 className="marketing-display-title marketing-hero-title">The demand already exists.</h1>
      <p className="marketing-hero-sub">Wanterest just finds it.</p>
      <ScanForm />
      <p className="marketing-hero-note">
        {"No keywords. No setup. "}
        <br className="marketing-hero-note-break" />
        Just real conversations.
      </p>
      <HeroWave />
    </header>
  );
}

function ProductProofStrip() {
  return (
    <div className="marketing-proof-strip">
      <div className="marketing-proof-step">
        <div className="marketing-proof-eyebrow">STEP 1 · UNDERSTAND</div>
        <div className="marketing-proof-title">Wanterest reads your product</div>
        <div className="marketing-proof-card">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>Acme</div>
          <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>B2B SaaS · Workflow automation</div>
        </div>
        <div className="marketing-proof-arrow">→</div>
      </div>

      <div className="marketing-proof-step">
        <div className="marketing-proof-eyebrow">STEP 2 · FIND</div>
        <div className="marketing-proof-title">Finds qualified demand</div>
        <div className="marketing-proof-card">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 5, background: "#FF4500", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>R</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em", color: "var(--color-positive)" }}>SWITCHING · 94%</span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>&ldquo;We&rsquo;re paying for half of HubSpot we never use. Has anyone moved to something simpler?&rdquo;</div>
        </div>
        <div className="marketing-proof-arrow">→</div>
      </div>

      <div className="marketing-proof-step">
        <div className="marketing-proof-eyebrow">STEP 3 · MAP</div>
        <div className="marketing-proof-title">Turns it into intelligence</div>
        <div className="marketing-proof-card" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 12.5 }}><span style={{ fontWeight: 600 }}>Pricing pressure</span> <span style={{ color: "var(--color-positive)", fontWeight: 700 }}>↑ 31%</span></div>
          <div style={{ fontSize: 12.5, color: "var(--color-ink-muted)" }}>Workflow simplicity</div>
          <div style={{ fontSize: 12.5, color: "var(--color-ink-muted)" }}>HubSpot alternative demand</div>
        </div>
        <div className="marketing-proof-arrow">→</div>
      </div>

      <div className="marketing-proof-step">
        <div className="marketing-proof-eyebrow">STEP 4 · ACT</div>
        <div className="marketing-proof-title">Recommends the next move</div>
        <div className="marketing-proof-card is-dark">
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", color: "var(--color-accent)", marginBottom: 6 }}>ACTION</div>
          <div style={{ fontSize: 12.5, color: "var(--color-dark-ink)", lineHeight: 1.5 }}>Make simplicity explicit in homepage positioning.</div>
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { index: "01", title: "Add your product", body: "Paste your website or describe what you sell." },
    { index: "02", title: "Wanterest understands it", body: "We map your product, audience, pains, and buying language automatically." },
    { index: "03", title: "See real demand", body: "Wanterest finds conversations where people already show need, intent, or frustration." },
  ];
  return (
    <section className="marketing-section is-tight is-alt" id="how-it-works">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">THE PROCESS</div>
        <h2 className="marketing-heading marketing-section-title is-tight">From product to demand in minutes.</h2>
        <div className="marketing-steps-grid">
          {steps.map((step, index) => (
            <Reveal key={step.index} delay={index * 80}>
              <div className="marketing-step">
                <div className="marketing-step-index">{step.index}</div>
                <div className="marketing-step-title">{step.title}</div>
                <div className="marketing-step-body">{step.body}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignalTypes() {
  return (
    <section className="marketing-section">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">SIGNAL, NOT NOISE</div>
        <h2 className="marketing-heading marketing-section-title">Not leads. Signals of real need.</h2>
        <p className="marketing-section-subtitle">
          <ResponsiveText
            full="Find qualified demand across the public conversations that matter to your market."
            short="Find qualified demand across the conversations that matter."
          />
        </p>
        <div className="marketing-signals-grid">
          <ProofSignalCard source="reddit" sourceLabel="Reddit" time="—" intentLabel="High intent" intentTone="accent" matchPercent={94} quote="Looking for a tool that can watch our inbox and CRM together. Recommendations?" />
          <ProofSignalCard source="hacker-news" sourceLabel="Hacker News" time="—" intentLabel="Problem signal" matchPercent={81} quote="Every week I reconcile the same invoices across three spreadsheets by hand." />
          <ProofSignalCard source="reddit" sourceLabel="Reddit" time="—" intentLabel="Switching intent" intentTone="accent" matchPercent={91} quote="We're paying for half of HubSpot we never use. Anyone moved to something simpler?" />
          <ProofSignalCard source="bluesky" sourceLabel="Bluesky" time="—" intentLabel="Alternative search" matchPercent={67} quote="Comparing Zapier vs a few newer tools for syncing leads into our CRM." />
        </div>
      </div>
    </section>
  );
}

function ProofSection() {
  return (
    <section className="marketing-section is-tight is-alt" id="examples">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">PROOF</div>
        <h2 className="marketing-heading marketing-section-title is-tight">See why a conversation matters before you open it.</h2>

        <div className="marketing-proof-stack">
          <div className="marketing-proof-stack-shadow is-back"><div className="marketing-proof-stack-shadow-filler" /></div>
          <div className="marketing-proof-stack-shadow is-mid"><div className="marketing-proof-stack-shadow-filler" /></div>
          <div className="marketing-proof-stack-main">
            <ProofSignalCard
              source="reddit"
              sourceLabel="Reddit"
              time="7h ago"
              intentLabel="High intent · 88%"
              intentTone="accent"
              matchPercent={88}
              quote="Looking for a tool that can watch our inbox and CRM together. Recommendations?"
              why="A direct request for the category of tool Wanterest belongs to."
              tags={["CRM sync"]}
            />
          </div>
        </div>

        <div className="marketing-proof-secondary-grid">
          <ProofSignalCard source="hacker-news" sourceLabel="Hacker News" time="1h ago" intentLabel="Problem · 81%" matchPercent={81} quote="Every week I reconcile the same invoices across three spreadsheets by hand." tags={["Manual ops"]} />
          <ProofSignalCard source="bluesky" sourceLabel="Bluesky" time="3h ago" intentLabel="Switching · 67%" matchPercent={67} quote="Getting priced out of our current ops tool at renewal. Anyone found a leaner alternative?" tags={["SaaS"]} />
        </div>
      </div>
    </section>
  );
}

function Qualification() {
  return (
    <section className="marketing-section is-tight">
      <div className="marketing-section-inner" style={{ maxWidth: 820, textAlign: "center" }}>
        <div className="marketing-section-eyebrow">QUALIFICATION</div>
        <h2 className="marketing-heading" style={{ fontSize: "clamp(28px, 3.7vw, 38px)", marginBottom: 16 }}>Not every mention is demand.</h2>
        <p style={{ fontSize: 15, color: "var(--color-ink-muted)", marginBottom: 48, lineHeight: 1.55 }}>Popularity doesn&rsquo;t create demand. Intent does.</p>
        <div className="marketing-qualify-grid">
          <div className="marketing-card marketing-qualify-card">
            <div className="marketing-qualify-meta">500K likes</div>
            <p className="marketing-qualify-quote">&ldquo;HubSpot lol&rdquo;</p>
            <span className="marketing-qualify-tag">NOT A SIGNAL</span>
          </div>
          <div className="marketing-card marketing-qualify-card is-featured">
            <div className="marketing-qualify-meta">2 likes</div>
            <p className="marketing-qualify-quote">
              &ldquo;Looking for a cheaper <mark>HubSpot</mark> alternative with SSO&rdquo;
            </p>
            <span className="marketing-qualify-tag is-strong">HIGH-CONFIDENCE SIGNAL</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function BeyondSignals() {
  return (
    <section className="marketing-section is-tight" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div className="marketing-section-eyebrow">BEYOND SIGNALS</div>
        <h2 className="marketing-display-title" style={{ fontSize: "clamp(28px, 3.7vw, 40px)", marginBottom: 16 }}>Understand demand. Then act on it.</h2>
        <p style={{ fontSize: 15, color: "var(--color-ink-muted)", maxWidth: 560, margin: "0 auto", lineHeight: 1.55 }}>
          <ResponsiveText
            full="See what your market wants, where you're missing it, what's changing — and what to do next."
            short="See what your market wants, where you're missing it, and what's changing."
          />
        </p>
      </div>
      <BeyondSignalsTabs />
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
    <section className="marketing-section is-tight">
      <div className="marketing-section-inner">
        <div className="marketing-section-eyebrow">WHY WANTEREST</div>
        <h2 className="marketing-heading marketing-section-title is-tight">Built for evidence, not guesses.</h2>
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
    <section className="marketing-section is-tight is-alt">
      <div className="marketing-section-inner" style={{ maxWidth: 900, textAlign: "center" }}>
        <div className="marketing-section-eyebrow">COMING SOON</div>
        <h2 className="marketing-heading" style={{ fontSize: "clamp(26px, 3.4vw, 36px)", marginBottom: 16 }}>Understand what buyers compare you against.</h2>
        <p style={{ fontSize: 14.5, color: "var(--color-ink-muted)", marginBottom: 44, maxWidth: 560, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
          <ResponsiveText
            full="See which alternatives buyers actually consider, and where neither product owns the demand."
            short="See which alternatives buyers actually consider."
          />
        </p>
        <div className="marketing-card marketing-competitor-card">
          <div className="marketing-competitor-columns">
            <div style={{ fontSize: 14, fontWeight: 600 }}>Your product</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink-muted)" }}>Competitor</div>
          </div>
          <div className="marketing-competitor-rows">
            <div>Demand overlap</div>
            <div>Positioning strength</div>
            <div>Unmet demand</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Positioning() {
  return (
    <section className="marketing-section is-tight" style={{ textAlign: "center" }}>
      <div className="marketing-section-eyebrow">THE DIFFERENCE</div>
      <h2 className="marketing-heading" style={{ fontSize: "clamp(26px, 3.6vw, 38px)", maxWidth: 720, margin: "0 auto 18px", lineHeight: 1.22 }}>
        Lead finders show you who might fit.
        <br />
        Wanterest shows you who is showing need.
      </h2>
      <p style={{ fontSize: 15, color: "var(--color-ink-muted)", maxWidth: 460, margin: "0 auto 56px", lineHeight: 1.55 }}>
        <ResponsiveText
          full="Stop guessing who to contact. Start with people already talking about the problem you solve."
          short="Stop guessing who to contact."
        />
      </p>
      <div className="marketing-compare-grid">
        <Reveal>
          <div className="marketing-compare-card">
            <div className="marketing-compare-eyebrow">The old way</div>
            <div className="marketing-compare-title">Lead finder</div>
            <div className="marketing-compare-list">
              <div className="marketing-compare-list-item"><span className="marketing-compare-list-item-dot" />Company filters</div>
              <div className="marketing-compare-list-item"><span className="marketing-compare-list-item-dot" />Contact lists</div>
              <div className="marketing-compare-list-item"><span className="marketing-compare-list-item-dot" />Cold outreach</div>
            </div>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="marketing-compare-card-dark">
            <div className="marketing-compare-card-dark-glow" />
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)", marginBottom: 18, position: "relative" }}>THE MODERN WAY</div>
            <div className="marketing-compare-brand">
              <div className="marketing-compare-brand-mark"><LogoMark size={17} /></div>
              <div className="marketing-compare-brand-text">wanterest</div>
            </div>
            <div className="marketing-compare-checks">
              <div className="marketing-compare-check-item"><span className="marketing-compare-check-mark">✓</span>Real conversations</div>
              <div className="marketing-compare-check-item"><span className="marketing-compare-check-mark">✓</span>Visible pain</div>
              <div className="marketing-compare-check-item"><span className="marketing-compare-check-mark">✓</span>Active intent</div>
              <div className="marketing-compare-check-item"><span className="marketing-compare-check-mark">✓</span>Context and timing</div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function DailyValue() {
  return (
    <section className="marketing-section is-tight is-alt">
      <div className="marketing-daily-inner">
        <div className="marketing-section-eyebrow">DAILY VALUE</div>
        <h2 className="marketing-heading" style={{ fontSize: "clamp(28px, 3.7vw, 38px)", marginBottom: 16 }}>Wake up to new opportunities.</h2>
        <p style={{ fontSize: 14.5, color: "var(--color-ink-muted)", marginBottom: 32, lineHeight: 1.55 }}>
          Wanterest keeps searching in the background and surfaces new demand every day.
        </p>
        <div className="marketing-daily-card">
          <div className="marketing-daily-card-head">
            <div className="marketing-daily-card-headline">7 new opportunities found today.</div>
            <div className="marketing-daily-pulse-dot" />
          </div>
          <div className="marketing-daily-ticker">
            <div className="marketing-daily-ticker-item" style={{ animationDelay: "0s" }}>
              <span className="marketing-daily-ticker-mark" style={{ background: "#FF4500" }}>R</span>
              New high-intent signal on Reddit — 94% match
            </div>
            <div className="marketing-daily-ticker-item" style={{ animationDelay: "3s" }}>
              <span className="marketing-daily-ticker-mark" style={{ background: "#FF6600" }}>Y</span>
              New problem signal on Hacker News — 81% match
            </div>
            <div className="marketing-daily-ticker-item" style={{ animationDelay: "6s" }}>
              <span className="marketing-daily-ticker-mark" style={{ background: "#0085FF" }}>B</span>
              New switching intent on Bluesky — 67% match
            </div>
          </div>
        </div>
        <a className="marketing-cta is-compact" href={APP_SIGNUP_URL}>See today&rsquo;s signals →</a>
      </div>
    </section>
  );
}

const FAQ_ITEMS = [
  {
    q: "Which sources does Wanterest scan?",
    a: "Reddit, Hacker News, and Bluesky today, with LinkedIn and more forums rolling out. All sources pull only from public, already-visible conversations.",
  },
  {
    q: "Is this just social listening with a new name?",
    a: "No. Social listening tracks mentions of your brand. Wanterest looks for people who've never heard of you but are already describing the exact problem you solve — then ranks how likely they are to buy.",
  },
  {
    q: "How is data collected — is it compliant?",
    a: "We only read public posts, the same way a person browsing the site would. We never scrape private messages, gated groups, or anything behind a login.",
  },
  {
    q: "How accurate is the match score?",
    a: 'Every match is scored against your specific product description and audience, not generic keywords. You can always see the "Why it matters" reasoning behind each score before you act on it.',
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes — plans cancel anytime from Settings, no calls or emails required.",
  },
];

function Faq() {
  return (
    <section className="marketing-section is-tight is-alt">
      <div className="marketing-section-inner" style={{ maxWidth: 720 }}>
        <div className="marketing-section-eyebrow">QUESTIONS</div>
        <h2 className="marketing-heading" style={{ fontSize: "clamp(26px, 3.4vw, 34px)", textAlign: "center", marginBottom: 48 }}>Before you start.</h2>
        <div className="marketing-faq-list">
          {FAQ_ITEMS.map((item) => (
            <div className="marketing-faq-item" key={item.q}>
              <div className="marketing-faq-question">{item.q}</div>
              <div className="marketing-faq-answer">{item.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="marketing-section is-tight is-alt marketing-final-cta">
      <h2 className="marketing-heading marketing-final-cta-title">The demand is already there.</h2>
      <p className="marketing-final-cta-sub">Find it.</p>
      <ScanForm compact />
    </section>
  );
}

function Footer() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-brand">
        <LogoMark size={16} />
        <span className="marketing-footer-tagline">Find real demand. Build what matters.</span>
      </div>
      <div className="marketing-footer-links">
        <a href="#how-it-works">Product</a>
        <a href="#pricing">Pricing</a>
        <span>Privacy</span>
        <span>Terms</span>
        <span>X</span>
      </div>
    </footer>
  );
}
