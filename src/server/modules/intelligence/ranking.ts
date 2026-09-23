import type { IntentType } from "./intelligence.schemas";

export const RANKING_FORMULA_VERSION = "ranker-v1";
export const RANKING_WEIGHTS = {
  semanticRelevance: 0.24,
  painAlignment: 0.20,
  buyerAlignment: 0.14,
  intentStrength: 0.18,
  specificity: 0.10,
  freshness: 0.08,
  sourceQuality: 0.06,
} as const;

export type RankingComponents = {
  semanticRelevance: number;
  painAlignment: number;
  buyerAlignment: number;
  intentStrength: number;
  specificity: number;
  freshness: number;
  sourceQuality: number;
};

export const INTENT_STRENGTH: Record<IntentType, number> = {
  high_intent: 1,
  switching_intent: 0.88,
  alternative_search: 0.82,
  problem_signal: 0.68,
  informational: 0.35,
  low_intent: 0.2,
  unknown: 0.1,
};

export const SOURCE_QUALITY: Record<string, number> = {
  fixture: 0.55,
  "hacker-news": 0.65,
  bluesky: 0.6,
  reddit: 0.62,
  github: 0.6,
  x: 0.55,
  "product-hunt": 0.55,
  "stack-exchange": 0.68,
  "public-web": 0.45,
  g2: 0.72,
  trustpilot: 0.65,
  youtube: 0.58,
  gitlab: 0.7,
};

export function freshnessScore(timestamp: string | null | undefined, now = new Date()): number {
  if (!timestamp) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 86_400_000);
  return Math.max(0, Math.min(1, Math.exp(-ageDays / 30)));
}

export function calculateOpportunityScore(components: RankingComponents): number {
  const values = Object.values(components);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("Ranking components must be normalized between 0 and 1.");
  return Math.max(0, Math.min(1,
    components.semanticRelevance * RANKING_WEIGHTS.semanticRelevance +
    components.painAlignment * RANKING_WEIGHTS.painAlignment +
    components.buyerAlignment * RANKING_WEIGHTS.buyerAlignment +
    components.intentStrength * RANKING_WEIGHTS.intentStrength +
    components.specificity * RANKING_WEIGHTS.specificity +
    components.freshness * RANKING_WEIGHTS.freshness +
    components.sourceQuality * RANKING_WEIGHTS.sourceQuality,
  ));
}

export function sourceQuality(sourceKey: string): number {
  return SOURCE_QUALITY[sourceKey] ?? 0.5;
}
