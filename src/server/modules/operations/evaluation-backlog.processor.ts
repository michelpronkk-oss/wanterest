import "server-only";

import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SupabaseIntelligenceRepository } from "@/server/modules/intelligence/intelligence.repository";
import { FixtureConversationAnalysisEngine, FixtureProductMatchingEngine } from "@/server/modules/intelligence/engines";
import { rebuildDemandIntelligenceForScan } from "@/server/modules/demand-intelligence/demand.orchestration";
import { isActiveProduct } from "@/server/modules/products/product-lifecycle";
import { evidenceFidelityGroundingEnabled } from "@/server/modules/intelligence/evidence-grounding";
import { processScanCandidates, selectScanCandidates } from "@/server/modules/onboarding/initial-scan.service";
import type { ScanDiscoveryProvenance } from "@/server/modules/ingestion/public-ingestion.service";
import type { ConversationRow, ProductRow, SourceItemRow } from "@/server/db/database.helpers";
import { BACKLOG_BATCH_SIZE, BACKLOG_SELECTION_VERSION, backlogFingerprint, claimBacklog, nextBacklogWake, settleBacklog, type BacklogRow } from "./evaluation-backlog.repository";

export function evaluationBacklogProcessingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EVALUATION_BACKLOG_PROCESSING_ENABLED !== "false";
}

type Outcome = { status: "succeeded" | "skipped"; code?: string; evaluationId?: string; signalId?: string | null };

async function processOne(row: BacklogRow): Promise<Outcome> {
  const client = createSupabaseServiceClient();
  const [productResult, conversationResult, sourceResult, profileResult] = await Promise.all([
    client.from("products").select("*").eq("workspace_id", row.workspace_id).eq("id", row.product_id).maybeSingle(),
    client.from("conversations").select("*").eq("id", row.conversation_id).maybeSingle(),
    client.from("source_items").select("*").eq("id", row.source_item_id).maybeSingle(),
    client.from("demand_profiles").select("id,workspace_id,product_id").eq("workspace_id", row.workspace_id).eq("id", row.demand_profile_id).maybeSingle(),
  ]);
  if (productResult.error || conversationResult.error || sourceResult.error || profileResult.error) throw new Error("BACKLOG_REVALIDATION_READ_FAILED");
  const product = productResult.data as ProductRow | null;
  const conversation = conversationResult.data as ConversationRow | null;
  const source = sourceResult.data as SourceItemRow | null;
  if (!product || !isActiveProduct(product) || product.current_demand_profile_id !== row.demand_profile_id ||
      !profileResult.data || profileResult.data.product_id !== row.product_id) return { status: "skipped", code: "PRODUCT_OR_PROFILE_CHANGED" };
  if (evidenceFidelityGroundingEnabled({ env: process.env, workspaceId: product.workspace_id }) !== row.grounding_enabled)
    return { status: "skipped", code: "EVALUATION_CONFIG_CHANGED" };
  if (!conversation || !source || conversation.primary_source_item_id !== source.id || source.status !== "active" ||
      conversation.content_hash !== row.conversation_content_hash || source.content_hash !== row.source_content_hash)
    return { status: "skipped", code: "SOURCE_OR_ROOT_CHANGED" };

  const [evidence, rootLink] = await Promise.all([
    client.from("evidence_nodes").select("id,node_type,entity_id,content_hash").in("id", [conversation.evidence_node_id, source.evidence_node_id]),
    client.from("conversation_source_items").select("conversation_id").eq("conversation_id", conversation.id)
      .eq("source_item_id", source.id).eq("is_primary", true).maybeSingle(),
  ]);
  if (evidence.error || rootLink.error) throw new Error("BACKLOG_EVIDENCE_READ_FAILED");
  const conversationEvidence = evidence.data?.find((node) => node.id === conversation.evidence_node_id);
  const sourceEvidence = evidence.data?.find((node) => node.id === source.evidence_node_id);
  if (!rootLink.data || conversationEvidence?.node_type !== "conversation" || conversationEvidence.entity_id !== conversation.id ||
      conversationEvidence.content_hash !== conversation.content_hash || sourceEvidence?.node_type !== "source_item" ||
      sourceEvidence.entity_id !== source.id || sourceEvidence.content_hash !== source.content_hash)
    return { status: "skipped", code: "PROVENANCE_INVALID" };

  // The scan's exact query provenance is private and immutable in the queue. Re-run
  // its existing evidence filters on current canonical content, never a new query.
  if (row.selection_provenance.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
      (entry as Record<string, unknown>).conversationId !== conversation.id ||
      typeof (entry as Record<string, unknown>).queryPlanId !== "string" ||
      typeof (entry as Record<string, unknown>).source !== "string" ||
      !Array.isArray((entry as Record<string, unknown>).concepts)))
    return { status: "skipped", code: "PROVENANCE_INVALID" };
  const provenance = row.selection_provenance as ScanDiscoveryProvenance[];
  const selection = selectScanCandidates({ conversations: [conversation], sourceById: new Map([[source.id, source]]), max: 1, provenance });
  if (row.selection_rank < 1 || row.selection_version !== BACKLOG_SELECTION_VERSION ||
      selection.conversations[0]?.id !== conversation.id) return { status: "skipped", code: "EVIDENCE_FILTER_CHANGED" };
  const fingerprint = backlogFingerprint({ productId: product.id, productName: product.name, profileId: row.demand_profile_id,
    conversation, source, classifierVersionId: row.classifier_engine_version_id,
    matcherVersionId: row.matcher_engine_version_id, groundingEnabled: row.grounding_enabled, provenance });
  if (fingerprint !== row.selection_fingerprint) return { status: "skipped", code: "CANDIDATE_FINGERPRINT_CHANGED" };
  const versions = await client.from("engine_versions").select("id,engine_type,version").in("id", [row.classifier_engine_version_id, row.matcher_engine_version_id]);
  if (versions.error) throw new Error("BACKLOG_ENGINE_READ_FAILED");
  const classifierVersion = versions.data?.find((value) => value.id === row.classifier_engine_version_id);
  const matcherVersion = versions.data?.find((value) => value.id === row.matcher_engine_version_id);
  if (classifierVersion?.engine_type !== "classifier" || classifierVersion.version !== new FixtureConversationAnalysisEngine().version ||
      matcherVersion?.engine_type !== "matcher" || matcherVersion.version !== new FixtureProductMatchingEngine().version)
    return { status: "skipped", code: "EVALUATION_ENGINE_CHANGED" };

  const repository = new SupabaseIntelligenceRepository(client);
  const existingMatch = await repository.getMatch(row.workspace_id, row.product_id, row.conversation_id);
  const existingSignal = existingMatch ? await repository.getSignalByMatch(existingMatch.id) : null;
  if (existingSignal) {
    if (row.attempt_count > 1) await rebuildDemandIntelligenceForScan({ product, evaluationIds: [existingSignal.product_match_evaluation_id], signalIds: [existingSignal.id], traceId: `evaluation-backlog:${row.id}` });
    return { status: row.attempt_count > 1 ? "succeeded" : "skipped", code: "SIGNAL_ALREADY_EXISTS",
      evaluationId: existingSignal.product_match_evaluation_id, signalId: existingSignal.id };
  }
  // This is the exact selected-candidate path, including its optional semantic
  // shadow, canonical fingerprint cache, ranking and signal lifecycle service.
  // Do not short-circuit on an existing evaluation here: a prior attempt may
  // have persisted it before signal materialization. The canonical fingerprint
  // cache prevents a duplicate row while allowing the signal path to resume.
  const result = await processScanCandidates({ product, profileId: row.demand_profile_id,
    normalizedSourceItemIds: [source.id], conversationIds: [conversation.id], provenance,
    traceId: `evaluation-backlog:${row.id}`, maxLlmEvaluations: 1 });
  const evaluationId = result.evaluationIds[0];
  if (!evaluationId || result.diagnostics.some((entry) => entry.state === "failed" && ["matching", "signals"].includes(entry.sourceKey)))
    throw new Error("BACKLOG_CANONICAL_EVALUATION_FAILED");
  const signalId = result.signalIds[0] ?? null;
  if (signalId) {
    // The same derived rebuild invoked by a normal qualifying scan; no Actions task.
    await rebuildDemandIntelligenceForScan({ product, evaluationIds: [evaluationId], signalIds: [signalId], traceId: `evaluation-backlog:${row.id}` });
  }
  return { status: "succeeded", code: result.outcomes[0]?.qualificationStatus === "qualified" && !signalId ? "QUALIFIED_NOT_MATERIALIZED" : undefined,
    evaluationId, signalId };
}

export async function processEvaluationBacklogBatch(limit = BACKLOG_BATCH_SIZE, onClaim?: () => Promise<void>): Promise<{
  claimed: number; succeeded: number; skipped: number; retryable: number; exhausted: number; nextWakeAt: string | null;
}> {
  if (!evaluationBacklogProcessingEnabled()) return { claimed: 0, succeeded: 0, skipped: 0, retryable: 0, exhausted: 0, nextWakeAt: null };
  const client = createSupabaseServiceClient();
  const owner = crypto.randomUUID();
  const rows = await claimBacklog(client, owner, limit);
  // Arm a delayed recovery before doing any evaluation. A hard task timeout
  // cannot run a finally block, so the durable lease needs an external wake.
  if (rows.length) await onClaim?.();
  const counts = { claimed: rows.length, succeeded: 0, skipped: 0, retryable: 0, exhausted: 0 };
  // One at a time within this run. Trigger's task queue also has concurrency 1.
  for (const row of rows) {
    try {
      const result = await processOne(row);
      await settleBacklog(client, row, owner, result);
      counts[result.status] += 1;
    } catch {
      const status = row.attempt_count >= 3 ? "exhausted" : "retryable";
      await settleBacklog(client, row, owner, { status, code: "EVALUATION_FAILED" });
      counts[status] += 1;
    }
  }
  return { ...counts, nextWakeAt: await nextBacklogWake(client) };
}
