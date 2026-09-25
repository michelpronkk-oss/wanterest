import type { Json } from "../../src/server/db/database.helpers";
import type { DemandClusteringEvidence, InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { signalQualificationSchema, type SignalQualification } from "../../src/server/modules/intelligence/signal-qualification.schemas";

/** Synthetic Stage 2G fixtures. Never written to any real database. */
export const workspaceA = "a1111111-1111-4111-8111-111111111111";
export const workspaceB = "b2222222-2222-4222-8222-222222222222";
export const productA = "a3333333-3333-4333-8333-333333333333";
export const productA2 = "a4444444-4444-4444-8444-444444444444";
export const productB = "b5555555-5555-4555-8555-555555555555";
export const engineVersionId = "e6666666-6666-4666-8666-666666666666";
export const now = new Date("2026-09-25T12:00:00.000Z");

export function qualification(input: {
  productId: string;
  concepts: string[];
  intent?: SignalQualification["primary_intent"];
  target?: SignalQualification["demand_target_type"];
  status?: SignalQualification["status"];
  quality?: number;
  confidence?: number;
  sourceProducts?: string[];
}): SignalQualification {
  const dimension = 0.8;
  return signalQualificationSchema.parse({
    version: "signal_qualification_v1_7",
    candidate_id: deterministicUuid(`candidate:${input.concepts.join(",")}:${input.intent ?? "explicit_pain"}`),
    product_id: input.productId,
    status: input.status ?? "qualified",
    demand_quality_score: input.quality ?? 0.8,
    confidence: input.confidence ?? 0.75,
    dimensions: { product_relevance: dimension, demand_intent: dimension, specificity: dimension, pain_clarity: dimension, buyer_plausibility: dimension, commercial_relevance: dimension, evidence_quality: dimension, freshness: dimension, source_quality: dimension, noise_risk: 0.1, spam_probability: 0, promotional_probability: 0 },
    primary_intent: input.intent ?? "explicit_pain",
    demand_target_type: input.target ?? "category",
    source_products: input.sourceProducts ?? [],
    matched_profile_concepts: input.concepts,
    evidence_spans: [],
    reason_codes: [],
    qualification_reason: "Synthetic fixture qualification.",
    resonance: { available: false, score: 0, likes: null, replies: null, reposts: null, upvotes: null, reactions: null, comments: null, source_normalized_metrics: {}, reason: "fixture" },
    diagnostics: { qualification_version: "signal_qualification_v1_7", threshold_version: "signal_qualification_thresholds_v1", analysis_version: null, demand_profile_version: "demand_profile_v2", profile_confidence: 0.8, evidence_validated: true, gate_failures: [], failed: false, failure_code: null },
  });
}

export type EvidenceSeed = {
  key: string;
  workspaceId?: string;
  productId?: string;
  concepts: string[];
  intent?: SignalQualification["primary_intent"];
  target?: SignalQualification["demand_target_type"];
  status?: SignalQualification["status"];
  decision?: string;
  source?: string;
  publishedAt?: string;
  contentKey?: string;
  conversationKey?: string;
  signalStatus?: string | null;
  quality?: number;
  sourceProducts?: string[];
  createdAt?: string;
  current?: boolean;
  matchKey?: string;
};

/** Seeds one evaluation's evidence chain and returns it (the repository keeps a reference). */
export function seedEvidence(repository: InMemoryDemandClusteringRepository, seed: EvidenceSeed): DemandClusteringEvidence {
  const workspaceId = seed.workspaceId ?? workspaceA;
  const productId = seed.productId ?? productA;
  const conversationKey = seed.conversationKey ?? seed.key;
  const matchKey = seed.matchKey ?? `${productId}:${conversationKey}`;
  const evaluationId = deterministicUuid(`evaluation:${productId}:${seed.key}`);
  const matchId = deterministicUuid(`match:${matchKey}`);
  const item: DemandClusteringEvidence = {
    evaluation: {
      id: evaluationId,
      workspace_id: workspaceId,
      product_id: productId,
      product_match_id: matchId,
      conversation_id: deterministicUuid(`conversation:${conversationKey}`),
      evidence_node_id: deterministicUuid(`evidence:evaluation:${productId}:${seed.key}`),
      decision: seed.decision ?? "qualified",
      evidence: { qualification: qualification({ productId, concepts: seed.concepts, intent: seed.intent, target: seed.target, status: seed.status, quality: seed.quality, sourceProducts: seed.sourceProducts }) } as unknown as Json,
      created_at: seed.createdAt ?? "2026-09-20T00:00:00.000Z",
    },
    currentEvaluationId: seed.current === false ? deterministicUuid(`newer-evaluation:${seed.key}`) : evaluationId,
    signal: seed.signalStatus === null ? null : { id: deterministicUuid(`signal:${matchKey}`), lifecycle_status: seed.signalStatus ?? "active", evidence_node_id: deterministicUuid(`evidence:signal:${matchKey}`) },
    conversation: { id: deterministicUuid(`conversation:${conversationKey}`), evidence_node_id: deterministicUuid(`evidence:conversation:${conversationKey}`), published_at: seed.publishedAt ?? "2026-09-18T00:00:00.000Z", last_activity_at: null },
    sourceItem: { id: deterministicUuid(`source:${conversationKey}`), evidence_node_id: deterministicUuid(`evidence:source:${conversationKey}`), source_key: seed.source ?? "github", content_hash: sha256Text(seed.contentKey ?? conversationKey), published_at: seed.publishedAt ?? "2026-09-18T00:00:00.000Z" },
  };
  repository.evidence.set(evaluationId, item);
  return item;
}
