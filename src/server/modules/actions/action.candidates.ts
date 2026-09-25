import type { DemandDriftRow, DemandGapRow, DemandSnapshotRow, ProductRow, SignalRow } from "../../db/database.helpers";
import type { ActionGenerationInput } from "./action.schemas";
import type { GeographyMarketSummary } from "../geography/geography.schemas";
import { sampleFactor } from "../demand-intelligence/demand.engines";
import { demandGapV2SampleQuality } from "../demand-intelligence/demand-gap-v2.policy";
import type { ConceptDriftStateRow, ConceptGapStateRow, ConceptMarketStateRow } from "../demand-intelligence/concept-market-state.repository";

type CandidateOptions = {
  conceptLabel?: string;
  targetKey?: string;
  supportingEvidence?: string[];
  actionEngineVersionId?: string;
};

function base(product: ProductRow, source: { id: string; evidence_node_id: string }, conceptLabel: string, options: CandidateOptions): Pick<ActionGenerationInput, "workspaceId" | "productId" | "productName" | "triggerId" | "triggerEvidenceNodeId" | "triggerConceptKey" | "conceptLabel" | "targetKey" | "buyerLanguage" | "supportingEvidence"> {
  return {
    workspaceId: product.workspace_id,
    productId: product.id,
    productName: product.name,
    triggerId: source.id,
    triggerEvidenceNodeId: source.evidence_node_id,
    triggerConceptKey: conceptLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 300),
    conceptLabel: options.conceptLabel ?? conceptLabel,
    targetKey: options.targetKey ?? "auto",
    buyerLanguage: [],
    supportingEvidence: options.supportingEvidence ?? [],
  };
}

export function actionInputFromGap(product: ProductRow, gap: DemandGapRow, options: CandidateOptions = {}): ActionGenerationInput {
  return {
    ...base(product, gap, gap.concept_key, options), triggerType: "demand_gap", marketWeight: gap.market_weight,
    gapScore: gap.gap_score, driftStrength: 0, intentStrength: gap.high_intent_share,
    opportunityScore: gap.gap_score, evidenceStrength: gap.confidence, confidence: gap.confidence,
    freshness: 1, sampleSize: gap.market_mentions, sampleQuality: gap.market_mentions >= 20 ? "high_confidence" : gap.market_mentions >= 5 ? "normal" : "low_confidence",
    positioningWeight: gap.positioning_weight, highIntentShare: gap.high_intent_share, specificity: gap.confidence,
    actionEngineVersionId: options.actionEngineVersionId,
  };
}

export function actionInputFromDrift(product: ProductRow, drift: DemandDriftRow, options: CandidateOptions = {}): ActionGenerationInput {
  return {
    ...base(product, drift, drift.concept_key, options), triggerType: "demand_drift", marketWeight: drift.current_share,
    gapScore: 0, driftStrength: Math.min(1, Math.abs(drift.share_delta) + Math.abs(drift.high_intent_delta)),
    intentStrength: drift.current_high_intent_share, opportunityScore: Math.min(1, Math.abs(drift.share_delta)),
    evidenceStrength: drift.confidence, confidence: drift.confidence, freshness: 1,
    sampleSize: Math.min(drift.current_mentions, drift.previous_mentions), sampleQuality: drift.current_mentions >= 20 && drift.previous_mentions >= 20 ? "high_confidence" : drift.current_mentions >= 5 && drift.previous_mentions >= 5 ? "normal" : "low_confidence",
    driftDirection: drift.drift_direction as ActionGenerationInput["driftDirection"], driftSignificance: drift.significance as ActionGenerationInput["driftSignificance"],
    positioningWeight: 0, highIntentShare: drift.current_high_intent_share, specificity: drift.confidence,
    actionEngineVersionId: options.actionEngineVersionId,
  };
}

export function actionInputFromSnapshot(product: ProductRow, snapshot: DemandSnapshotRow, options: CandidateOptions = {}): ActionGenerationInput {
  return {
    ...base(product, snapshot, options.conceptLabel ?? "strong demand theme", options), triggerType: "demand_snapshot", marketWeight: snapshot.confidence,
    gapScore: snapshot.confidence, driftStrength: 0, intentStrength: snapshot.qualified_signal_count > 0 ? 0.7 : 0.3,
    opportunityScore: snapshot.confidence, evidenceStrength: snapshot.confidence, confidence: snapshot.confidence,
    freshness: 1, sampleSize: snapshot.sample_size, sampleQuality: snapshot.measurement_quality as ActionGenerationInput["sampleQuality"],
    positioningWeight: 0, highIntentShare: 0.5, specificity: snapshot.confidence,
    actionEngineVersionId: options.actionEngineVersionId,
  };
}

export function actionInputFromGeoMarket(product: ProductRow, snapshot: DemandSnapshotRow, market: GeographyMarketSummary, options: CandidateOptions = {}): ActionGenerationInput {
  const theme = market.topDemandTheme ?? market.topPain ?? "qualified demand";
  const place = market.level === "region" ? `${market.marketName}, ${market.countryName}` : market.countryName;
  const marketShare = market.level === "region" ? market.shareOfParentMarket : market.shareOfGeoQualifiedDemand;
  return {
    ...base(product, snapshot, `${place} ${theme}`, { ...options, targetKey: options.targetKey ?? "regional_positioning", conceptLabel: options.conceptLabel ?? `${place}: ${theme}` }),
    triggerType: "demand_snapshot",
    marketWeight: marketShare,
    gapScore: 0,
    driftStrength: market.trend.hasEnoughHistory && market.trend.percentage !== null ? Math.min(1, Math.abs(market.trend.percentage) / 100) : 0,
    intentStrength: market.topIntent ? 0.7 : 0.4,
    opportunityScore: Math.min(1, marketShare + (market.trend.direction === "growing" ? 0.15 : 0)),
    evidenceStrength: Math.min(1, market.qualifiedSignalCount / 30),
    confidence: Math.min(1, market.qualifiedSignalCount / 30),
    freshness: 1,
    sampleSize: market.qualifiedSignalCount,
    sampleQuality: market.sampleState === "higher_confidence" ? "high_confidence" : market.sampleState === "directional" ? "normal" : market.sampleState === "emerging" ? "low_confidence" : "insufficient_data",
    positioningWeight: 0,
    highIntentShare: market.topIntent ? 0.7 : 0,
    specificity: Math.min(1, market.qualifiedSignalCount / 20),
    geoContext: { market: place, topTheme: market.topDemandTheme ?? market.topPain, trendPercentage: market.trend.percentage, sampleSize: market.qualifiedSignalCount },
    actionEngineVersionId: options.actionEngineVersionId,
  };
}

export function actionInputFromSignal(product: ProductRow, signal: SignalRow, options: CandidateOptions & { opportunityScore: number; confidence: number; specificity: number } ): ActionGenerationInput {
  return {
    ...base(product, signal, signal.why_it_matters, options), triggerType: "signal", marketWeight: options.opportunityScore,
    gapScore: 0, driftStrength: 0, intentStrength: signal.intent_type === "high_intent" || signal.intent_type === "switching_intent" ? 1 : 0.5,
    opportunityScore: options.opportunityScore, evidenceStrength: options.confidence, confidence: options.confidence,
    freshness: 1, sampleSize: 5, sampleQuality: "normal", positioningWeight: 0,
    highIntentShare: signal.intent_type === "high_intent" ? 1 : 0.5, specificity: options.specificity,
    buyerLanguage: signal.buyer_language && Array.isArray(signal.buyer_language) ? signal.buyer_language.filter((value): value is string => typeof value === "string") : [],
    actionEngineVersionId: options.actionEngineVersionId,
  };
}

/** Same "switch + evaluate intent families = high commercial intent" definition demand-gap-v2.policy.ts's highIntentShareOf already uses. */
function marketStateHighIntentShare(marketState: ConceptMarketStateRow): number {
  if (marketState.contributing_membership_count <= 0) return 0;
  const mix = marketState.intent_family_mix;
  const record = mix && typeof mix === "object" && !Array.isArray(mix) ? (mix as Record<string, unknown>) : {};
  const count = (typeof record.switch === "number" ? record.switch : 0) + (typeof record.evaluate === "number" ? record.evaluate : 0);
  return Math.max(0, Math.min(1, count / marketState.contributing_membership_count));
}

/**
 * Layer 9C: a persisted, lifecycle-verified concept_gap_states basis. Only a
 * "scored" gap state may reach this — callers must check that before invoking.
 * See docs/architecture.md Section 18.
 */
export function actionInputFromConceptGap(product: ProductRow, gapState: ConceptGapStateRow, marketState: ConceptMarketStateRow, options: CandidateOptions = {}): ActionGenerationInput {
  const sampleQuality = demandGapV2SampleQuality(marketState.distinct_evidence_count);
  const confidence = sampleFactor(sampleQuality);
  return {
    ...base(product, gapState, options.conceptLabel ?? gapState.anchor_concept_key, options),
    // Layer 10: canonical concept identity is the opaque anchor key exactly as persisted (never re-normalized) plus its clustering version.
    triggerConceptKey: gapState.anchor_concept_key, triggerClusteringVersion: gapState.clustering_version,
    triggerType: "concept_gap", marketWeight: gapState.share_of_current_demand,
    gapScore: gapState.gap_score ?? 0, driftStrength: 0, intentStrength: gapState.high_intent_share,
    opportunityScore: gapState.gap_score ?? 0, evidenceStrength: confidence, confidence,
    freshness: 1, sampleSize: marketState.distinct_evidence_count, sampleQuality,
    positioningWeight: gapState.positioning_weight, highIntentShare: gapState.high_intent_share, specificity: confidence,
    actionEngineVersionId: options.actionEngineVersionId,
  };
}

/**
 * Layer 9C: a persisted, lifecycle-verified concept_drift_states basis. Only a
 * comparable, rising, notable/strong-significance drift state may reach this
 * with a real effect — callers should still run it through
 * actionCandidateIsQualified, which enforces that. See docs/architecture.md
 * Section 18.
 */
export function actionInputFromConceptDrift(product: ProductRow, driftState: ConceptDriftStateRow, marketState: ConceptMarketStateRow, options: CandidateOptions = {}): ActionGenerationInput {
  const minCount = Math.min(driftState.current_frozen_evidence_count ?? 0, driftState.previous_frozen_evidence_count ?? 0);
  const sampleQuality = demandGapV2SampleQuality(minCount);
  const confidence = sampleFactor(sampleQuality);
  const shareDelta = driftState.share_delta ?? 0;
  // Same count/20 normalization demand.service.ts's aggregateDemand already uses for its own confidence scaling.
  const marketWeight = Math.min(1, (driftState.current_frozen_evidence_count ?? 0) / 20);
  return {
    ...base(product, driftState, options.conceptLabel ?? driftState.anchor_concept_key, options),
    triggerConceptKey: driftState.anchor_concept_key, triggerClusteringVersion: driftState.clustering_version,
    triggerType: "concept_drift", marketWeight,
    gapScore: 0, driftStrength: Math.min(1, Math.abs(shareDelta)), intentStrength: marketStateHighIntentShare(marketState),
    opportunityScore: Math.min(1, Math.abs(shareDelta)), evidenceStrength: confidence, confidence,
    freshness: 1, sampleSize: minCount, sampleQuality,
    driftDirection: (driftState.direction as ActionGenerationInput["driftDirection"]) ?? undefined, driftSignificance: (driftState.significance as ActionGenerationInput["driftSignificance"]) ?? undefined,
    positioningWeight: 0, highIntentShare: marketStateHighIntentShare(marketState), specificity: confidence,
    actionEngineVersionId: options.actionEngineVersionId,
  };
}
