import type { PublicShareCard } from "@/server/modules/share-cards";

export function PublicIntelligenceDetails({ card, issueHref }: { card: PublicShareCard; issueHref: string }) {
  return (
    <section className="share-card-intelligence-details" aria-labelledby="share-card-finding-title">
      <div className="share-card-intelligence-section">
        <div className="ui-section-label">{card.claimType === "interpretation" ? "Interpretation" : "Observation"}</div>
        <h2 id="share-card-finding-title">{card.claim ?? "Evidence-backed market finding"}</h2>
        {card.interpretation && card.claimType === "observation" ? <p><strong>Wanterest context.</strong> {card.interpretation}</p> : null}
      </div>
      <div className="share-card-intelligence-section">
        <div className="ui-section-label">Supporting evidence</div>
        <p className="share-card-intelligence-evidence">{card.evidence ?? "The published finding is backed by the authoritative Wanterest evidence record."}</p>
        <dl className="share-card-intelligence-meta">
          {card.evidenceStrength ? <div><dt>Evidence strength</dt><dd>{card.evidenceStrength}</dd></div> : null}
          {card.freshnessLabel ? <div><dt>Freshness</dt><dd>{card.freshnessLabel}</dd></div> : null}
          {card.observationPeriod ? <div><dt>Observation period</dt><dd>{card.observationPeriod}</dd></div> : null}
          {card.sourceLabel ? <div><dt>Source context</dt><dd>{card.sourceLabel}</dd></div> : null}
        </dl>
        {card.sourceUrl ? <p className="share-card-intelligence-source"><a href={card.sourceUrl} target="_blank" rel="noreferrer noopener">Open original source ↗</a></p> : null}
      </div>
      <div className="share-card-intelligence-section share-card-intelligence-uncertainty">
        <div className="ui-section-label">What remains uncertain</div>
        <p>{card.uncertainty ?? "This published finding is not a market-wide estimate, forecast, or proof of causation."}</p>
      </div>
      <p className="share-card-page-source-note"><a href={issueHref}>Report a source or evidence issue</a>. Public source links are provided for context; Wanterest does not republish raw provider payloads.</p>
    </section>
  );
}
