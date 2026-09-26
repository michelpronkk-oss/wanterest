import type { ProductMatchEvaluationRow, SignalRow } from "../../db/database.helpers";
import type { IntelligenceRepository } from "./intelligence.repository";
import { buildQualificationProfile } from "./intelligence.service";
import { failClosedQualification, qualificationFromEvidence, qualifySignal, qualifySignalWithReasoning, type SignalQualificationInput } from "./signal-qualification.service";
import { conversationMarketReasoningSchema, type ConversationMarketReasoning, type SignalQualification } from "./signal-qualification.schemas";
import type { ProductMatchResult } from "./intelligence.schemas";
import { decideRevalidationAction } from "./signal-revalidation.service";
import { evidenceFidelityGroundingEnabled, EVIDENCE_HISTORICAL_THRESHOLD_DAYS } from "./evidence-grounding";
import type { SemanticShadowReasoningRepository } from "./semantic-shadow-reasoning.repository";
import type { DemandClusterRow, DemandClusterMembershipRow, DemandClusteringRepository } from "../demand-intelligence/demand-clustering.repository";
import { DEMAND_CLUSTERING_VERSION } from "../demand-intelligence/demand-clustering.policy";

export const SIGNAL_REVALIDATION_PREVIEW_VERSION = "signal_revalidation_preview_v1" as const;

/** Mirrors the existing SIGNAL_REVALIDATION_MAX_PER_TICK bound: a preview is bounded work, never a global sweep. */
export const SIGNAL_REVALIDATION_PREVIEW_MAX_SIGNALS = 50;

export type SignalRevalidationPreviewDecision =
  | "KEEP"
  | "KEEP_WITH_GROUNDED_WORDING_CHANGE"
  | "WOULD_INVALIDATE"
  | "ALREADY_NON_CONTRIBUTING"
  | "REQUIRES_SEMANTIC_VERIFICATION"
  | "CANNOT_ASSESS";

/**
 * evaluation_semantic_cache_v2-style least-privilege repository: a Pick of
 * ONLY read methods from the real IntelligenceRepository. None of
 * createEvaluation/setCurrentEvaluation/updateSignal/createMatch/etc. are part
 * of this type, so calling them on a value typed as this interface is a
 * compile error - and tests construct real objects that never define those
 * methods at all, so an accidental call also fails immediately at runtime.
 */
export type SignalRevalidationPreviewIntelligenceRepository = Pick<
  IntelligenceRepository,
  "getProduct" | "getProductSnapshots" | "getDemandProfileById" | "getConversation" | "getSourceItem" | "getConversationAnalysisById" | "getMatchById" | "getEvaluationById" | "listSignals"
>;

/** Same least-privilege pattern for cluster impact simulation - read-only, never a writer. */
export type SignalRevalidationPreviewClusterRepository = Pick<DemandClusteringRepository, "listClusters" | "listMemberships">;

/** loadForReplay is already a pre-existing, already read-only method - reused, not duplicated or widened. */
export type SignalRevalidationPreviewShadowRepository = Pick<SemanticShadowReasoningRepository, "loadForReplay">;

export type SupportFlag =
  | "unsupported_switching"
  | "unsupported_competitor_attribution"
  | "unsupported_purchase_intent"
  | "unsupported_willingness_to_pay"
  | "unsupported_migration_intent"
  | "unsupported_urgency"
  | "wrong_actor_stance"
  | "wrong_target"
  | "common_word_entity_collision"
  | "vendor_promotional_stance_mistaken_for_buyer_demand"
  | "temporal_overstatement";

export type SignalRevalidationPreviewResult = {
  signal_id: string;
  workspace_id: string;
  product_id: string | null;
  current: {
    lifecycle_status: string;
    created_at: string;
    intent_type: string | null;
    reason_text: string | null;
    conversation_id: string;
    source_key: string | null;
    source_item_id: string | null;
    published_at: string | null;
    literal_source_evidence: string | null;
    evaluation_id: string | null;
    evaluation_status: SignalQualification["status"] | null;
    grounding_version: string | null;
    materialization_gate_version: string | null;
  };
  fresh: {
    intent: SignalQualification["primary_intent"] | null;
    authorial_stance: string | null;
    target_type: SignalQualification["demand_target_type"] | null;
    target_name: string | null;
    reason_codes: string[];
    qualification_status: SignalQualification["status"] | null;
    evidence_published_at: string | null;
    grounding_version: string | null;
    materialization_gate_version: string | null;
  } | null;
  temporal: {
    published_at: string | null;
    discovered_at: string;
    age_at_signal_creation_days: number | null;
    age_now_days: number | null;
    classification: "historical" | "recent" | "current_support_unknown";
  };
  support_flags: SupportFlag[];
  decision: SignalRevalidationPreviewDecision;
  reason: string;
};

export type ClusterImpactPreview = {
  cluster_id: string;
  cluster_key: string;
  current_contributing_count: number;
  would_stop_contributing_signal_ids: string[];
  projected_contributing_count: number;
  still_has_support: boolean;
};

export type SignalRevalidationPreviewReport = {
  version: typeof SIGNAL_REVALIDATION_PREVIEW_VERSION;
  workspace_id: string;
  signal_ids_considered: string[];
  results: SignalRevalidationPreviewResult[];
  counts: Record<SignalRevalidationPreviewDecision, number>;
  cluster_impact: ClusterImpactPreview[];
};

function ageDays(from: string | null, to: Date): number | null {
  if (!from) return null;
  const parsed = new Date(from);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((to.getTime() - parsed.getTime()) / 86_400_000);
}

function classifyTemporal(publishedAt: string | null, now: Date): "historical" | "recent" | "current_support_unknown" {
  const age = ageDays(publishedAt, now);
  if (age === null) return "current_support_unknown";
  return age >= EVIDENCE_HISTORICAL_THRESHOLD_DAYS ? "historical" : "recent";
}

/** Literal, conservative - never asserts a flag the evidence doesn't plainly support. */
function classifySupportFlags(input: { signal: SignalRow; fresh: SignalQualification; temporal: "historical" | "recent" | "current_support_unknown" }): SupportFlag[] {
  const flags: SupportFlag[] = [];
  const currentIntent = input.signal.intent_type;
  const freshCodes = new Set(input.fresh.reason_codes);
  const freshEvidenceCount = input.fresh.evidence_spans.length;

  if (currentIntent === "switching_intent" && input.fresh.primary_intent !== "switching_intent" && freshEvidenceCount === 0) flags.push("unsupported_switching");
  if (input.fresh.demand_target_type === "third_party_product" && input.fresh.source_products.length === 0 && input.fresh.demand_target_name) flags.push("unsupported_competitor_attribution");
  if (freshCodes.has("STRONG_SWITCHING_INTENT") === false && currentIntent === "switching_intent" && input.fresh.status === "rejected") flags.push("unsupported_switching");
  if (input.fresh.conversation_reasoning.authorial_stance === "vendor_marketing") flags.push("vendor_promotional_stance_mistaken_for_buyer_demand");
  if (input.fresh.speaker_role === "unknown" && input.signal.tags && Array.isArray(input.signal.tags) && (input.signal.tags as unknown[]).includes("buyer_confirmed")) flags.push("wrong_actor_stance");
  if (input.fresh.demand_target_name && input.signal.excerpt && !input.signal.excerpt.toLowerCase().includes(input.fresh.demand_target_name.toLowerCase()) && input.fresh.demand_target_type !== "unknown") flags.push("wrong_target");
  if (input.temporal === "historical" && (input.signal.why_it_matters ?? "").match(/\b(is|are|currently|now|actively)\b/i)) flags.push("temporal_overstatement");
  return flags;
}

async function loadReusableReasoningOverride(shadow: SignalRevalidationPreviewShadowRepository, workspaceId: string, productId: string, conversationId: string): Promise<ConversationMarketReasoning | null> {
  const rows = await shadow.loadForReplay({ workspaceId, productId, conversationId });
  const reusable = rows.find((row) => row.execution_status === "success" || row.execution_status === "cache_hit");
  if (!reusable) return null;
  const parsed = conversationMarketReasoningSchema.safeParse(reusable.merged_shadow_reasoning);
  return parsed.success ? parsed.data : null;
}

function matchResultFromEvaluation(evaluation: ProductMatchEvaluationRow): ProductMatchResult {
  const record = evaluation.evidence && typeof evaluation.evidence === "object" && !Array.isArray(evaluation.evidence) ? evaluation.evidence as Record<string, unknown> : {};
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    decision: evaluation.decision as ProductMatchResult["decision"],
    matchConfidence: Number(evaluation.match_confidence),
    // Display-only field; not read by qualifySignal's scoring. The exact pre-concatenation
    // rationale text isn't separately recoverable from the persisted (already-merged) column,
    // so the stored evaluation rationale is reused verbatim rather than guessed.
    rationale: evaluation.rationale || "Reconstructed from a prior evaluation for preview purposes.",
    evidence: { painAlignment: strings(record.painAlignment), buyerAlignment: strings(record.buyerAlignment), capabilityAlignment: strings(record.capabilityAlignment), intentRelevance: strings(record.intentRelevance) },
  };
}

/**
 * Builds and evaluates ONE signal's preview result. Every dependency here is
 * read-only by type; nothing in this function can mutate anything.
 */
export async function previewSignalRevalidation(input: {
  intelligence: SignalRevalidationPreviewIntelligenceRepository;
  shadow: SignalRevalidationPreviewShadowRepository;
  signal: SignalRow;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<SignalRevalidationPreviewResult> {
  const { signal, intelligence, shadow } = input;
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const base = {
    signal_id: signal.id,
    workspace_id: signal.workspace_id,
    product_id: signal.product_id,
    current: {
      lifecycle_status: signal.lifecycle_status,
      created_at: signal.created_at,
      intent_type: signal.intent_type,
      reason_text: signal.why_it_matters,
      conversation_id: signal.conversation_id,
      source_key: signal.source_key,
      source_item_id: null as string | null,
      published_at: signal.published_at,
      literal_source_evidence: signal.excerpt,
      evaluation_id: signal.product_match_evaluation_id,
      evaluation_status: null as SignalQualification["status"] | null,
      grounding_version: null as string | null,
      materialization_gate_version: null as string | null,
    },
    temporal: {
      published_at: signal.published_at,
      discovered_at: signal.created_at,
      age_at_signal_creation_days: ageDays(signal.published_at, new Date(signal.created_at)),
      age_now_days: ageDays(signal.published_at, now),
      classification: classifyTemporal(signal.published_at, now),
    },
  };

  const cannotAssess = (reason: string): SignalRevalidationPreviewResult => ({ ...base, fresh: null, support_flags: [], decision: "CANNOT_ASSESS", reason });

  // Existing lifecycle semantics are preserved, not recomputed: a signal that is already
  // dismissed/archived/invalidated/retracted is already non-contributing regardless of what a
  // fresh qualification would say - this mirrors decideRevalidationAction's own "skipped" case
  // for a signal that never materialized, just keyed off the CURRENT lifecycle state instead.
  if (signal.lifecycle_status !== "active" && signal.lifecycle_status !== "saved") {
    return { ...base, fresh: null, support_flags: [], decision: "ALREADY_NON_CONTRIBUTING", reason: `signal lifecycle_status is already "${signal.lifecycle_status}"` };
  }

  if (!signal.product_match_evaluation_id) return cannotAssess("signal has no linked current evaluation");
  const evaluation = await intelligence.getEvaluationById(signal.product_match_evaluation_id);
  if (!evaluation) return cannotAssess("linked evaluation could not be read");
  const previousQualification = qualificationFromEvidence(evaluation.evidence);
  base.current.evaluation_status = previousQualification?.status ?? null;
  base.current.grounding_version = previousQualification?.diagnostics.grounding_version ?? null;
  base.current.materialization_gate_version = previousQualification?.diagnostics.materialization_gate_version ?? null;

  const match = await intelligence.getMatchById(evaluation.product_match_id);
  if (!match) return cannotAssess("product match could not be read");
  const conversation = await intelligence.getConversation(evaluation.conversation_id);
  if (!conversation) return cannotAssess("conversation could not be read");
  const sourceItem = await intelligence.getSourceItem(conversation.primary_source_item_id);
  if (!sourceItem) return cannotAssess("source item could not be read");
  base.current.source_item_id = sourceItem.id;
  const analysis = await intelligence.getConversationAnalysisById(evaluation.conversation_analysis_id);
  if (!analysis) return cannotAssess("conversation analysis could not be read");
  const product = await intelligence.getProduct(evaluation.product_id);
  if (!product) return cannotAssess("product could not be read");
  const profile = await intelligence.getDemandProfileById(evaluation.demand_profile_id);
  if (!profile) return cannotAssess("demand profile could not be read");
  const snapshots = await intelligence.getProductSnapshots(product.id);

  const groundingEnabled = evidenceFidelityGroundingEnabled({ env, workspaceId: signal.workspace_id });
  const qualificationProfile = buildQualificationProfile(product, profile, snapshots);
  const freshInput: SignalQualificationInput = {
    candidateId: conversation.id,
    productId: product.id,
    productName: product.name,
    conversation,
    sourceItem,
    analysis,
    match: matchResultFromEvaluation(evaluation),
    profile: qualificationProfile,
    groundingEnabled,
    now,
  };

  let fresh: SignalQualification;
  try {
    fresh = qualifySignal(freshInput);
  } catch (error) {
    fresh = failClosedQualification({ candidateId: conversation.id, productId: product.id, profile: qualificationProfile, analysis }, error instanceof Error ? error.message.slice(0, 120) : "QUALIFICATION_FAILED");
  }

  if (fresh.diagnostics.materialization_verification_required && !fresh.diagnostics.materialization_verified) {
    const reasoningOverride = await loadReusableReasoningOverride(shadow, signal.workspace_id, product.id, conversation.id);
    if (reasoningOverride) {
      try {
        fresh = qualifySignalWithReasoning(freshInput, reasoningOverride, []);
      } catch (error) {
        fresh = failClosedQualification({ candidateId: conversation.id, productId: product.id, profile: qualificationProfile, analysis }, error instanceof Error ? error.message.slice(0, 120) : "QUALIFICATION_FAILED");
      }
    }
    if (!reasoningOverride || (fresh.diagnostics.materialization_verification_required && !fresh.diagnostics.materialization_verified)) {
      return {
        ...base,
        fresh: { intent: fresh.primary_intent, authorial_stance: fresh.conversation_reasoning.authorial_stance, target_type: fresh.demand_target_type, target_name: fresh.demand_target_name, reason_codes: fresh.reason_codes, qualification_status: fresh.status, evidence_published_at: fresh.evidence_published_at, grounding_version: fresh.diagnostics.grounding_version, materialization_gate_version: fresh.diagnostics.materialization_gate_version },
        support_flags: [],
        decision: "REQUIRES_SEMANTIC_VERIFICATION",
        reason: `high-risk claim (${fresh.diagnostics.materialization_risk_reasons.join(", ") || "materialization risk"}) has no reusable persisted semantic artifact - not guessed`,
      };
    }
  }

  const decision = decideRevalidationAction({ previous: previousQualification, fresh });
  const mapped: SignalRevalidationPreviewDecision = decision.action === "invalidated" ? "WOULD_INVALIDATE" : decision.action === "skipped" ? "ALREADY_NON_CONTRIBUTING" : decision.action === "reconfirmed" ? "KEEP_WITH_GROUNDED_WORDING_CHANGE" : "KEEP";
  const temporalNow = classifyTemporal(fresh.evidence_published_at, now);
  const supportFlags = classifySupportFlags({ signal, fresh, temporal: temporalNow });

  return {
    ...base,
    fresh: { intent: fresh.primary_intent, authorial_stance: fresh.conversation_reasoning.authorial_stance, target_type: fresh.demand_target_type, target_name: fresh.demand_target_name, reason_codes: fresh.reason_codes, qualification_status: fresh.status, evidence_published_at: fresh.evidence_published_at, grounding_version: fresh.diagnostics.grounding_version, materialization_gate_version: fresh.diagnostics.materialization_gate_version },
    support_flags: supportFlags,
    decision: mapped,
    reason: decision.reason,
  };
}

/**
 * Top-level, bounded, workspace-scoped preview. Never mutates anything: every
 * dependency it receives is read-only by type, and it performs no writes of
 * its own anywhere in this function.
 */
export async function previewWorkspaceSignalRevalidation(input: {
  intelligence: SignalRevalidationPreviewIntelligenceRepository;
  cluster: SignalRevalidationPreviewClusterRepository;
  shadow: SignalRevalidationPreviewShadowRepository;
  workspaceId: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<SignalRevalidationPreviewReport> {
  const all = await input.intelligence.listSignals(input.workspaceId);
  const scoped = all.filter((signal) => signal.workspace_id === input.workspaceId);
  const ordered = [...scoped].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
  const bounded = ordered.slice(0, SIGNAL_REVALIDATION_PREVIEW_MAX_SIGNALS);

  const results: SignalRevalidationPreviewResult[] = [];
  for (const signal of bounded) results.push(await previewSignalRevalidation({ intelligence: input.intelligence, shadow: input.shadow, signal, env: input.env, now: input.now }));

  const counts: Record<SignalRevalidationPreviewDecision, number> = { KEEP: 0, KEEP_WITH_GROUNDED_WORDING_CHANGE: 0, WOULD_INVALIDATE: 0, ALREADY_NON_CONTRIBUTING: 0, REQUIRES_SEMANTIC_VERIFICATION: 0, CANNOT_ASSESS: 0 };
  for (const result of results) counts[result.decision] += 1;

  const productIds = [...new Set(results.map((result) => result.product_id).filter((value): value is string => Boolean(value)))];
  const clusterImpact = await simulateClusterImpact({ cluster: input.cluster, workspaceId: input.workspaceId, productIds, results });

  return { version: SIGNAL_REVALIDATION_PREVIEW_VERSION, workspace_id: input.workspaceId, signal_ids_considered: bounded.map((signal) => signal.id), results, counts, cluster_impact: clusterImpact };
}

/**
 * Cluster impact is scoped to (workspace_id, product_id, clustering_version) -
 * the same composite scope demand_clustering_v1 itself uses. Only products
 * actually represented among the previewed signals are queried; this never
 * sweeps every product in the workspace.
 */
async function simulateClusterImpact(input: { cluster: SignalRevalidationPreviewClusterRepository; workspaceId: string; productIds: string[]; results: SignalRevalidationPreviewResult[] }): Promise<ClusterImpactPreview[]> {
  const wouldInvalidateSignalByEvaluationId = new Map(
    input.results.filter((result) => result.decision === "WOULD_INVALIDATE" && result.current.evaluation_id).map((result) => [result.current.evaluation_id as string, result.signal_id]),
  );

  const impact: ClusterImpactPreview[] = [];
  for (const productId of input.productIds) {
    const [clusters, memberships]: [DemandClusterRow[], DemandClusterMembershipRow[]] = await Promise.all([
      input.cluster.listClusters(input.workspaceId, productId, DEMAND_CLUSTERING_VERSION),
      input.cluster.listMemberships(input.workspaceId, productId, DEMAND_CLUSTERING_VERSION),
    ]);
    for (const cluster of clusters) {
      const clusterMemberships = memberships.filter((membership) => membership.cluster_id === cluster.id);
      const currentContributing = clusterMemberships.length;
      const wouldStop = clusterMemberships
        .filter((membership) => wouldInvalidateSignalByEvaluationId.has(membership.match_evaluation_id))
        .map((membership) => wouldInvalidateSignalByEvaluationId.get(membership.match_evaluation_id)!);
      impact.push({ cluster_id: cluster.id, cluster_key: cluster.cluster_key, current_contributing_count: currentContributing, would_stop_contributing_signal_ids: wouldStop, projected_contributing_count: currentContributing - wouldStop.length, still_has_support: currentContributing - wouldStop.length > 0 });
    }
  }
  return impact;
}
