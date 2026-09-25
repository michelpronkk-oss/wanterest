import type { CurrentGeographyHeadline, CurrentGeographyReadModel } from "@/server/modules/geography/current-geography.policy";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Layer 9D: current, lifecycle-aware Geography. Renders only what geography.currentEvidenceCount actually is — never blended with the historical section below it. */
export function CurrentGeographySummary({ geography, headline }: { geography: CurrentGeographyReadModel; headline: CurrentGeographyHeadline }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="insights-stat-grid">
        <div className="insights-stat-card"><div className="insights-stat-card-label">Current geographic evidence</div><div className="insights-stat-card-value">{geography.currentEvidenceCount}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Known location</div><div className="insights-stat-card-value">{geography.knownLocationCount}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Unknown location</div><div className="insights-stat-card-value">{geography.unknownLocationCount}</div></div>
        <div className="insights-stat-card"><div className="insights-stat-card-label">Coverage of known location</div><div className="insights-stat-card-value" style={{ fontSize: 15 }}>{geography.reliableCoveragePercent}%</div></div>
      </div>

      <div className="ui-card ui-card-pad-lg" style={{ marginTop: 16 }}>
        <div className="ui-section-label" style={{ marginBottom: 2 }}>{headline.title}</div>
        <p style={{ fontSize: 12.5, color: "var(--color-ink-muted)", marginBottom: geography.countries.length ? 10 : 0 }}>{headline.body}</p>
        {geography.countries.length ? (
          <div>
            {geography.countries.map((country) => (
              <div key={country.countryCode} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderTop: "1px solid var(--color-border-soft)" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{country.countryName}</span>
                <span style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
                  {plural(country.currentEvidenceCount, "conversation")} · {country.percentageOfAllCurrentEvidence}% of all current · {country.percentageOfKnownLocationEvidence}% of known location
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function currentGeographyCaption(geography: CurrentGeographyReadModel): string {
  return `As of ${new Date(geography.generatedAt).toLocaleDateString()}, ${plural(geography.currentEvidenceCount, "current conversation")} considered.`;
}
