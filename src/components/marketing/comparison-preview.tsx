import { MarketingBand, MarketingPill } from "./marketing-band";

const MENTION_SHARE = [
  { key: "you", label: "Only you", share: 14 },
  { key: "both", label: "Both considered", share: 31 },
  { key: "competitor", label: "Only competitor", share: 28 },
  { key: "neither", label: "Neither", share: 27 },
] as const;

const PREFERENCE = [
  { key: "you", label: "You", share: 30 },
  { key: "undecided", label: "Undecided", share: 28 },
  { key: "competitor", label: "Competitor", share: 42 },
] as const;

function MentionShareBar() {
  return (
    <div className="marketing-compare-block">
      <div className="marketing-compare-block-head">
        <h4>Who buyers mention</h4>
        <span>Share of all qualified conversations</span>
      </div>
      <div
        className="marketing-mention-bar"
        role="img"
        aria-label={`Illustrative share of qualified conversations: ${MENTION_SHARE.map((s) => `${s.label.toLowerCase()} ${s.share}%`).join(", ")}.`}
      >
        {MENTION_SHARE.map((segment) => (
          <div className={`marketing-mention-segment is-${segment.key}`} style={{ flexGrow: segment.share }} key={segment.key}>
            <div className="marketing-mention-fill">
              {segment.key === "both" ? (
                <>
                  <i />
                  <i />
                </>
              ) : (
                `${segment.share}%`
              )}
            </div>
            <span className="marketing-mention-label">
              {segment.label}
              {segment.key === "both" ? <> · <strong>{segment.share}%</strong></> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsiderationMetric() {
  return (
    <div className="marketing-compare-metric">
      <div className="marketing-compare-metric-label">
        <h4>Consideration</h4>
        <p>Is the product mentioned at all? Share of all 1,240 conversations.</p>
      </div>
      <div className="marketing-meter-pair" role="img" aria-label="Illustrative consideration: your product 45%, competitor 59%.">
        <div className="marketing-meter">
          <div className="marketing-meter-track"><div className="marketing-meter-fill is-you" style={{ width: "45%" }} /></div>
          <span>45%</span>
        </div>
        <div className="marketing-meter">
          <div className="marketing-meter-track"><div className="marketing-meter-fill is-competitor" style={{ width: "59%" }} /></div>
          <span className="is-muted">59%</span>
        </div>
      </div>
      <MarketingPill tone="secondary">Competitor +14 pts</MarketingPill>
    </div>
  );
}

function PreferenceMetric() {
  return (
    <div className="marketing-compare-metric">
      <div className="marketing-compare-metric-label">
        <h4>Clear preference</h4>
        <p>When buyers compare both, who do they lean toward? Based on 384 conversations.</p>
      </div>
      <div className="marketing-preference">
        <div className="marketing-preference-bar" aria-hidden="true">
          {PREFERENCE.map((part) => (
            <div className={`is-${part.key}`} style={{ flexGrow: part.share }} key={part.key} />
          ))}
        </div>
        <div className="marketing-preference-labels">
          {PREFERENCE.map((part) => (
            <span className={`is-${part.key}`} style={{ flexGrow: part.share }} key={part.key}>
              {part.label} <strong>{part.share}%</strong>
            </span>
          ))}
        </div>
      </div>
      <MarketingPill tone="secondary">Competitor +12 pts</MarketingPill>
    </div>
  );
}

/** Comparison (coming soon) — "Wanterest Qualification + Why.dc.html", screen 4. Illustrative data only. */
export function ComparisonPreviewSection() {
  return (
    <MarketingBand
      id="comparison"
      tone="soft"
      eyebrow="COMING SOON"
      title="Understand what buyers compare you against."
      subtitle="Discover who buyers consider, where competitors have the edge, and which needs remain underserved."
      subtitleMaxWidth={460}
    >
      <div className="marketing-compare-panel">
        <div className="marketing-panel-head is-centered">
          <div className="marketing-panel-heading">
            <h3>Comparison intelligence</h3>
            <div className="marketing-compare-context">
              <span className="marketing-compare-badge">Illustrative data</span>
              <span>1,240 qualified conversations · Last 90 days</span>
            </div>
          </div>
          <div className="marketing-compare-legend">
            <span><i className="is-you" aria-hidden="true" />Your product</span>
            <span className="marketing-compare-vs">VS</span>
            <span><i className="is-competitor" aria-hidden="true" />Competitor</span>
          </div>
        </div>
        <MentionShareBar />
        <div className="marketing-compare-metrics">
          <ConsiderationMetric />
          <PreferenceMetric />
        </div>
        <div className="marketing-compare-callout">
          <div className="marketing-brief-glow is-wide" aria-hidden="true" />
          <div className="marketing-compare-callout-main">
            <strong className="marketing-compare-callout-value">27%</strong>
            <div className="marketing-compare-callout-copy">
              <h4>Potentially underserved demand</h4>
              <p>335 conversations describe the need without naming either product. Worth investigating before treating as a gap.</p>
            </div>
          </div>
          <span className="marketing-dark-chip">Review evidence →</span>
        </div>
      </div>
    </MarketingBand>
  );
}
