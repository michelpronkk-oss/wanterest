import type { SignalQualificationPrimaryIntent } from "./signal-qualification.schemas";

// Bump this whenever logic that affects qualification dimensions changes (e.g. the
// product_relevance composition in signal-qualification.service.ts's dimensionsFor). It is
// hashed into intelligence.service.ts's evaluation input_fingerprint, so a version bump is
// what makes a repeat scan recompute qualification against existing conversations/analyses
// instead of reusing a cached evaluation computed under the old logic — no re-fetching, no
// duplicate conversations, and (via product_match_evaluations' stable product_match_id)
// existing signal lifecycle state (dismissed/saved/archived) is preserved automatically.
export const SIGNAL_QUALIFICATION_VERSION = "signal_qualification_v1_7" as const;
// Bump this only when the qualified/highConfidence THRESHOLD VALUES below change — they have
// not; product_relevance's composition changed, which SIGNAL_QUALIFICATION_VERSION already
// captures.
export const SIGNAL_QUALIFICATION_THRESHOLD_VERSION = "signal_qualification_thresholds_v1" as const;

export const SIGNAL_QUALIFICATION_THRESHOLDS = {
  qualified: {
    productRelevance: 0.65,
    demandIntent: 0.6,
    painClarity: 0.7,
    specificity: 0.4,
    evidenceQuality: 0.6,
    spamProbabilityMaxExclusive: 0.35,
    promotionalProbabilityMaxExclusive: 0.5,
  },
  highConfidence: {
    productRelevance: 0.8,
    demandIntent: 0.8,
    specificity: 0.65,
    evidenceQuality: 0.8,
    commercialRelevance: 0.7,
    confidence: 0.8,
    noiseRiskMaxExclusive: 0.25,
  },
} as const;

export const STRONG_COMMERCIAL_INTENTS: readonly SignalQualificationPrimaryIntent[] = [
  "switching_intent",
  "alternative_search",
  "recommendation_request",
  "purchase_research",
  "comparison_intent",
  "vendor_evaluation",
  "renewal_reconsideration",
  "feature_requirement",
];

export const SIGNAL_QUALIFICATION_WEIGHTS = {
  productRelevance: 0.2,
  demandIntent: 0.2,
  specificity: 0.12,
  painClarity: 0.12,
  buyerPlausibility: 0.08,
  commercialRelevance: 0.12,
  evidenceQuality: 0.1,
  freshness: 0.03,
  sourceQuality: 0.03,
} as const;

export const SIGNAL_QUALIFICATION_PENALTIES = {
  noiseRisk: 0.12,
  spamProbability: 0.12,
  promotionalProbability: 0.08,
} as const;
