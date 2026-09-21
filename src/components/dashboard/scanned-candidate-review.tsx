import type { ScanCandidateReview } from "@/server/modules/operations/product-demand-scan.schemas";

const REASON_LABELS: Record<string, string> = {
  LOW_RELEVANCE: "Low product relevance",
  INSUFFICIENT_INTENT: "Weak buying intent",
  INSUFFICIENT_SPECIFICITY: "Too generic",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
  NOISE_RISK: "Promotional or noisy",
  SPAM_RISK: "Possible spam",
  PROMOTIONAL_CONTENT: "Promotional content",
  LINK_ONLY: "Link-only result",
  GEO_MISMATCH: "Outside the target market",
  LOW_PROFILE_CONFIDENCE: "Low product-profile confidence",
  ENGAGEMENT_NOT_QUALIFYING: "Not enough engagement context",
  QUALIFICATION_FAILED: "Qualification could not be completed",
};

const POSITIVE_REASON_CODES = new Set([
  "STRONG_EVIDENCE",
  "STRONG_SWITCHING_INTENT",
  "STRONG_ALTERNATIVE_INTENT",
  "RECOMMENDATION_INTENT",
  "COMPARISON_INTENT",
  "CLEAR_FEATURE_REQUIREMENT",
  "COMMERCIAL_CONTEXT_PRESENT",
  "SPECIFIC_PAIN",
  "EXPLICIT_PAIN",
  "CLEAR_BUYER_CONTEXT",
  "BUYER_CONTEXT_PRESENT",
  "HIGH_PRODUCT_RELEVANCE",
]);

function reasonLabel(code: string): string {
  if (REASON_LABELS[code]) return REASON_LABELS[code];
  return code.toLowerCase().replaceAll("_", " ").replace(/^\w/, (value) => value.toUpperCase());
}

export function candidateReviewReasonLabels(reasonCodes: string[]): string[] {
  const reasons = reasonCodes.filter((code) => !POSITIVE_REASON_CODES.has(code)).map(reasonLabel);
  return [...new Set(reasons)].slice(0, 4);
}

function score(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sourceLabel(value: string): string {
  return value === "hacker-news" ? "Hacker News" : value === "github" ? "GitHub" : value === "x" ? "X" : value;
}

export function ScannedCandidateReview({ candidates }: { candidates: ScanCandidateReview[] }) {
  if (!candidates.length) return null;

  return (
    <details className="scan-candidate-review">
      <summary>Review scanned conversations</summary>
      <div className="scan-candidate-review-list">
        {candidates.map((candidate) => {
          const reasons = candidateReviewReasonLabels(candidate.reasonCodes);
          return (
            <article className="scan-candidate-card" key={candidate.evaluationId}>
              <div className="scan-candidate-card-header">
                <span className="badge">{sourceLabel(candidate.source)}</span>
                <span className="scan-candidate-result">{candidate.status === "weak_candidate" ? "Weak candidate" : "Filtered out"}</span>
              </div>
              <h3>{candidate.title || candidate.excerpt}</h3>
              <p>{candidate.excerpt}</p>
              {candidate.canonicalUrl ? <a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}
              <div className="scan-candidate-reasons">
                {(reasons.length ? reasons : ["Did not meet the current demand threshold"]).map((reason) => <span key={reason}>{reason}</span>)}
              </div>
              <div className="scan-candidate-scores" aria-label="Qualification score summary">
                <span>Relevance {score(candidate.scores.relevance)}</span>
                <span>Intent {score(candidate.scores.intent)}</span>
                <span>Pain {score(candidate.scores.pain)}</span>
                <span>Specificity {score(candidate.scores.specificity)}</span>
                <span>Evidence {score(candidate.scores.evidence)}</span>
                <span>Noise {score(candidate.scores.noise)}</span>
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
