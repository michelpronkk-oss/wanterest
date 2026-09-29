import { SourceBrandIcon } from "@/components/ui/source-brand-icon";
import { APP_START_URL } from "./links";
import { MarketingBand, MarketingPill } from "./marketing-band";

type DayTone = "rest" | "warm" | "ink" | "today";

const WEEK: { day: string; height: number; tone: DayTone }[] = [
  { day: "Mon", height: 30, tone: "rest" },
  { day: "Tue", height: 42, tone: "rest" },
  { day: "Wed", height: 36, tone: "rest" },
  { day: "Thu", height: 55, tone: "warm" },
  { day: "Fri", height: 62, tone: "warm" },
  { day: "Sat", height: 74, tone: "ink" },
  { day: "Today", height: 92, tone: "today" },
];

const FINDINGS = [
  {
    source: "reddit",
    sourceName: "Reddit",
    finding: "Teams want SSO without enterprise pricing.",
    meta: "First seen Mon · Source attached",
    state: { label: "Rising", tone: "lime", arrow: true },
  },
  {
    source: "hacker-news",
    sourceName: "Hacker News",
    finding: "Setup time is the main reason buyers switch.",
    meta: "First seen today · Qualified",
    state: { label: "New", tone: "tint", arrow: false },
  },
  {
    source: "bluesky",
    sourceName: "Bluesky",
    finding: "Interest in AI note-taking is flattening.",
    meta: "First seen last month · Bounded window",
    state: { label: "Cooling", tone: "muted", arrow: false },
  },
] as const;

const BRIEF_STATS = [
  { label: "New findings", value: "2" },
  { label: "Changed state", value: "3" },
  { label: "Evidence", value: "Source-linked", accent: true },
] as const;

function WeekChart() {
  return (
    <div
      className="marketing-week-chart"
      role="img"
      aria-label="Illustrative qualified activity for the last seven days, rising from Monday to its highest level today."
    >
      {WEEK.map(({ day, height, tone }) => (
        <div className="marketing-week-day" key={day}>
          <div className="marketing-week-track">
            <div className={`marketing-week-bar is-${tone}`} style={{ height: `${height}%` }} />
          </div>
          <span className={tone === "today" ? "is-today" : undefined}>{day}</span>
        </div>
      ))}
    </div>
  );
}

/** Daily value — "Wanterest Qualification + Why.dc.html", screen 3. */
export function DailyValueSection() {
  return (
    <MarketingBand
      id="daily-value"
      tone="stone"
      eyebrow="DAILY VALUE"
      title="A clearer market picture, over time."
      subtitle="Each day, new conversations are qualified and every finding keeps its source, window and state as your market moves."
      subtitleMaxWidth={460}
    >
      <div className="marketing-daily-panel">
        <div className="marketing-daily-panel-main">
          <div className="marketing-panel-head">
            <div className="marketing-panel-heading">
              <h3>This week in your market</h3>
              <span>Illustrative view · Observation window: 7 days</span>
            </div>
            <MarketingPill tone="ink" size="md">
              <span className="marketing-live-dot" aria-hidden="true" />
              Updated daily
            </MarketingPill>
          </div>
          <WeekChart />
          <ul className="marketing-daily-findings">
            {FINDINGS.map((item) => (
              <li className="marketing-daily-finding" key={item.finding}>
                <SourceBrandIcon sourceKey={item.source} label={item.sourceName} size={22} />
                <div className="marketing-daily-finding-text">
                  <p>{item.finding}</p>
                  <span>{item.meta}</span>
                </div>
                <MarketingPill tone={item.state.tone}>
                  {item.state.arrow ? <span aria-hidden="true">↑</span> : null}
                  {item.state.label}
                </MarketingPill>
              </li>
            ))}
          </ul>
        </div>
        <aside className="marketing-brief" aria-label="Today’s brief">
          <div className="marketing-brief-glow" aria-hidden="true" />
          <div className="marketing-brief-head">
            <span className="marketing-brief-icon" aria-hidden="true">✦</span>
            <h3>Today&rsquo;s brief</h3>
          </div>
          <p className="marketing-brief-copy">SSO demand is rising for the third day. Consider leading pricing pages with it.</p>
          <dl className="marketing-brief-stats">
            {BRIEF_STATS.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd className={"accent" in stat ? "is-accent" : undefined}>{stat.value}</dd>
              </div>
            ))}
          </dl>
          <span className="marketing-dark-chip is-pinned">Open the evidence →</span>
        </aside>
      </div>
      <a className="marketing-band-cta" href={APP_START_URL}>
        See the product <span aria-hidden="true">→</span>
      </a>
    </MarketingBand>
  );
}
