import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import {
  ActionsIcon,
  ExperimentsIcon,
  HomeIcon,
  InsightsIcon,
  LogoMark,
  SavedIcon,
  SettingsIcon,
  SignalsIcon,
} from "@/components/dashboard/nav-icons";

/*
 * Hero product window — the "Today" overview from "Wanterest App Redesign.dc.html" (C1 Home).
 * Illustrative example content only (example product, counts and quotes), never live customer
 * data. The canvas is laid out at the design's native app width and scaled to the window, so the
 * dashboard keeps its real proportions at every desktop/tablet size. Phones get a compact stack.
 */

const NAV = [
  { label: "Home", Icon: HomeIcon, count: null },
  { label: "Signals", Icon: SignalsIcon, count: 12 },
  { label: "Saved", Icon: SavedIcon, count: 3 },
  { label: "Insights", Icon: InsightsIcon, count: null },
  { label: "Actions", Icon: ActionsIcon, count: 1 },
  { label: "Experiments", Icon: ExperimentsIcon, count: null },
  { label: "Settings", Icon: SettingsIcon, count: null },
] as const;

const STATS = [
  { label: "Qualified", value: "12", note: "+4 since last scan", accent: true },
  { label: "High intent", value: "5", note: "42% of signals", accent: false },
  { label: "Sources", value: "4 of 5", note: "X pending", accent: false },
] as const;

type Intent = "high" | "switching" | "problem";

const SIGNALS: { source: string; where: string; age: string; intent: Intent; label: string; strength: number; score: number; title: string; tags: string[] }[] = [
  { source: "reddit", where: "r/sales", age: "7h", intent: "high", label: "HIGH INTENT", strength: 4, score: 88, title: "Asking for one tool that watches inbox and CRM together", tags: ["CRM sync", "Inbox"] },
  { source: "reddit", where: "r/SaaS", age: "1d", intent: "switching", label: "SWITCHING", strength: 5, score: 91, title: "Paying for HubSpot features they never use, wants simpler", tags: ["HubSpot alternative", "Pricing"] },
  { source: "hacker-news", where: "Hacker News", age: "1d", intent: "problem", label: "PROBLEM", strength: 4, score: 81, title: "Reconciles the same invoices across three spreadsheets weekly", tags: ["Manual ops"] },
];

const CHANGES = [
  { label: "Pricing pressure", delta: "↑ 31%", up: true, strong: true },
  { label: "Workflow simplicity", delta: "↑ 12%", up: true, strong: false },
  { label: "Manual reconciliation", delta: "↓ 8%", up: false, strong: false },
] as const;

const MARKET_STATE = "Teams are actively looking for a simpler CRM-sync tool. Pricing pressure against HubSpot is the fastest-rising reason.";

function Strength({ filled, score }: { filled: number; score: number }) {
  return (
    <span className="marketing-app-strength">
      <span>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < filled ? "is-on" : undefined} />)}</span>
      <b>{score}</b>
    </span>
  );
}

function SignalCard({ signal }: { signal: (typeof SIGNALS)[number] }) {
  return (
    <div className="marketing-app-signal">
      <div className="marketing-app-signal-head">
        <SourceBrandIcon sourceKey={signal.source} size={20} decorative />
        <span className="marketing-app-signal-where">{signal.where}</span>
        <span className="marketing-app-signal-age">{signal.age}</span>
        <span className="marketing-app-signal-meta">
          <span className={`marketing-app-intent is-${signal.intent}`}>{signal.label}</span>
          <Strength filled={signal.strength} score={signal.score} />
        </span>
      </div>
      <p className="marketing-app-signal-title">{signal.title}</p>
      <div className="marketing-app-signal-tags">
        {signal.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
    </div>
  );
}

const MOBILE_STATS = [
  { label: "Qualified", value: "12", note: "+4 new", accent: true },
  { label: "High intent", value: "5", note: "42% of all", accent: false },
  { label: "Sources", value: "4/5", note: "X pending", accent: false },
] as const;

/**
 * Phones: a light "Today" card instead of the scaled window — app header with live status, the
 * market state in ink type, three stats on hairlines and the strongest signal nested inside.
 */
function MobileToday() {
  const signal = SIGNALS[1];
  return (
    <div className="marketing-app-mobile" aria-hidden="true">
      <div className="marketing-app-mobile-card">
        <div className="marketing-app-mobile-head">
          <span className="marketing-app-mobile-app"><LogoMark size={15} />Today</span>
          <span className="marketing-app-fresh"><span />Scanned 2h ago</span>
        </div>
        <div className="marketing-app-mobile-state">
          <span className="marketing-app-mobile-label">MARKET STATE</span>
          <p>Teams want a simpler CRM-sync tool. <mark>Pricing pressure against HubSpot</mark> is rising fastest.</p>
        </div>
        <div className="marketing-app-mobile-stats">
          {MOBILE_STATS.map((stat) => (
            <div key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <em className={stat.accent ? "is-accent" : undefined}>{stat.note}</em>
            </div>
          ))}
        </div>
        <div className="marketing-app-mobile-signal">
          <div className="marketing-app-mobile-signal-inner">
          <div className="marketing-app-signal-head">
            <SourceBrandIcon sourceKey={signal.source} size={18} decorative />
            <span className="marketing-app-signal-where">{signal.where}</span>
            <span className="marketing-app-signal-age">{signal.age}</span>
            <span className="marketing-app-signal-meta">
              <span className={`marketing-app-intent is-${signal.intent}`}>{signal.label}</span>
              <Strength filled={signal.strength} score={signal.score} />
            </span>
          </div>
          <p className="marketing-app-signal-title">{signal.title}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketState() {
  return (
    <div className="marketing-app-market">
      <div className="marketing-app-market-grid">
        <div className="marketing-app-market-copy">
          <div className="marketing-app-market-label"><span />MARKET STATE</div>
          <p>{MARKET_STATE}</p>
        </div>
        <div className="marketing-app-market-stats">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <span className="marketing-app-market-stat-label">{stat.label}</span>
              <div>
                <strong>{stat.value}</strong>
                <span className={stat.accent ? "is-accent" : undefined}>{stat.note}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="marketing-app-market-foot">
        <span className="marketing-app-market-done"><span />Scan complete · 2h ago</span>
        <span>1,284 conversations read</span>
        <span>37 relevant</span>
        <span className="marketing-app-market-link">View evidence →</span>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <div className="marketing-app-sidebar">
      <div className="marketing-app-logo"><LogoMark size={19} /><span>wanterest</span></div>
      <div className="marketing-app-switcher">
        <span className="marketing-app-switcher-mark">A</span>
        <div><span>AUTERIM</span><strong>Auterim Flow</strong></div>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#a3a399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 6 3.5 3.5L11.5 6" /></svg>
      </div>
      <div className="marketing-app-nav">
        {NAV.map(({ label, Icon, count }) => {
          const active = label === "Home";
          return (
            <div key={label} className={`marketing-app-nav-item${active ? " is-active" : ""}`}>
              <Icon color={active ? "#111110" : "#6f6f67"} />
              <span>{label}</span>
              {count ? <em>{count}</em> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RescanIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" /></svg>
  );
}

function TopBar() {
  return (
    <div className="marketing-app-topbar">
      <div className="marketing-app-search">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="#a3a399" strokeWidth="1.3" /><path d="M13 13L9.8 9.8" stroke="#a3a399" strokeWidth="1.3" strokeLinecap="round" /></svg>
        <span>Search signals, themes, actions</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="marketing-app-topbar-right">
        <span className="marketing-app-fresh"><span />Scanned 2h ago</span>
        <span className="marketing-app-button is-secondary is-toolbar"><RescanIcon color="#111110" />Rescan</span>
        <span className="marketing-app-divider" />
        <span className="marketing-app-bell">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#4a4a43" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14h3" /></svg>
          <span />
        </span>
      </div>
    </div>
  );
}

function TodayPage() {
  return (
    <div className="marketing-app-page">
      <div className="marketing-app-page-head">
        <div>
          <div className="marketing-app-page-title">Today</div>
          <div className="marketing-app-page-sub">12 qualified signals from 4 sources. 5 show buying intent.</div>
        </div>
        <span className="marketing-app-button is-primary">Open signals →</span>
      </div>
      <MarketState />
      <div className="marketing-app-columns">
        <div>
          <div className="marketing-app-section-label"><span>Strongest signals</span><b>All 12 →</b></div>
          <div className="marketing-app-signals">
            {SIGNALS.map((signal) => <SignalCard key={signal.title} signal={signal} />)}
          </div>
        </div>
        <div className="marketing-app-side">
          <div>
            <div className="marketing-app-section-label"><span>Recommended next move</span></div>
            <div className="marketing-app-move">
              <div className="marketing-app-move-head"><span>POSITIONING</span><em>Priority 1 of 1</em></div>
              <p className="marketing-app-move-title">Make &ldquo;simpler than HubSpot&rdquo; explicit on your homepage.</p>
              <p className="marketing-app-move-copy">7 signals cite unused complexity as the reason to switch.</p>
              <div className="marketing-app-move-actions"><span className="marketing-app-button is-primary is-toolbar">Review action</span><span className="marketing-app-button is-quiet is-toolbar">Dismiss</span></div>
            </div>
          </div>
          <div>
            <div className="marketing-app-section-label is-tight"><span>What changed</span></div>
            <div className="marketing-app-changes">
              {CHANGES.map((change) => (
                <div key={change.label}>
                  <span className={change.strong ? "is-strong" : undefined}>{change.label}</span>
                  <b className={change.up ? "is-up" : "is-down"}>{change.delta}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroDashboardPreview() {
  return (
    <div
      className="marketing-hero-preview-slot"
      role="img"
      aria-label="Illustrative preview of the Wanterest Today overview: market state, qualified signal counts, the strongest signals and a recommended next move"
    >
      <div className="marketing-hero-preview" aria-hidden="true">
        <div className="marketing-app-canvas">
          <div className="marketing-app-chrome">
            <div><span /><span /><span /></div>
            <div className="marketing-app-url">app.wanterest.com</div>
          </div>
          <div className="marketing-app-shell">
            <Sidebar />
            <div className="marketing-app-main">
              <TopBar />
              <TodayPage />
            </div>
          </div>
        </div>
      </div>
      <MobileToday />
    </div>
  );
}
