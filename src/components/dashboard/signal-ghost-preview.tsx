type GhostRow = { source: string; intent: string; accent: boolean };

const ROWS: GhostRow[] = [
  { source: "Reddit", intent: "High intent", accent: true },
  { source: "Hacker News", intent: "Switching intent", accent: true },
  { source: "Bluesky", intent: "Problem signal", accent: false },
  { source: "GitHub", intent: "Alternative search", accent: false },
];

/** Structural preview of the Signals product UI — real card anatomy, placeholder copy, no fabricated posts. */
export function SignalGhostPreview({ count = 3 }: { count?: number }) {
  return (
    <div className="signal-list ghost-list">
      {ROWS.slice(0, count).map((row) => (
        <div className="signal-card is-ghost" key={row.intent} aria-hidden="true">
          <div className="signal-card-topline">
            <span className="signal-source-mark is-ghost-badge">{row.source.charAt(0)}</span>
            <span className="signal-source-name">{row.source}</span>
            <span className="signal-source-time">—</span>
            <div className="signal-topline-end">
              <span className={`badge ${row.accent ? "badge-accent" : "badge-neutral"}`}>{row.intent}</span>
              <span className="signal-score is-ghost-text">— % match</span>
            </div>
          </div>
          <p className="signal-excerpt is-ghost-text">Conversation excerpt appears here, verbatim from the source.</p>
          <p className="signal-why is-ghost-text">
            <span className="signal-why-label">Why</span>
            Why this conversation signals real demand.
          </p>
        </div>
      ))}
    </div>
  );
}
