import { SourceBrandIcon } from "@/components/ui/source-brand-icon";

type GhostRow = { source: string; sourceKey: string; intent: string; accent: boolean };

const ROWS: GhostRow[] = [
  { source: "Reddit", sourceKey: "reddit", intent: "High intent", accent: true },
  { source: "Hacker News", sourceKey: "hacker-news", intent: "Switching intent", accent: true },
  { source: "Bluesky", sourceKey: "bluesky", intent: "Problem signal", accent: false },
  { source: "GitHub", sourceKey: "github", intent: "Alternative search", accent: false },
];

/** Structural preview of the Signals product UI — real card anatomy, placeholder copy, no fabricated posts. */
export function SignalGhostPreview({ count = 3 }: { count?: number }) {
  return (
    <div className="signal-list ghost-list">
      {ROWS.slice(0, count).map((row) => (
        <div className="signal-card is-ghost" key={row.intent} aria-hidden="true">
          <div className="signal-card-topline">
            <SourceBrandIcon sourceKey={row.sourceKey} className="signal-source-mark is-ghost-badge" decorative />
            <span className="signal-source-name">{row.source}</span>
            <span className="signal-source-time">—</span>
            <div className="signal-topline-end">
              <span className={`badge ${row.accent ? "badge-accent" : "badge-neutral"}`}>{row.intent}</span>
              <span className="signal-score is-ghost-text">— % match</span>
            </div>
          </div>
          <p className="signal-summary is-ghost-text">A concise signal summary appears here.</p>
          <p className="signal-why is-ghost-text">
            <span className="signal-why-label">Why</span>
            Why this conversation signals real demand.
          </p>
        </div>
      ))}
    </div>
  );
}
