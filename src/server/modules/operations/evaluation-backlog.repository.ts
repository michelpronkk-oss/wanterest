import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/server/db/database.types";
import type { ConversationRow, SourceItemRow } from "@/server/db/database.helpers";
import { sha256Json } from "@/server/modules/ingestion/hash";
import type { ScanDiscoveryProvenance } from "@/server/modules/ingestion/public-ingestion.service";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "@/server/modules/intelligence/signal-qualification.config";
import { PRODUCT_MATCH_EVALUATION_FINGERPRINT_VERSION } from "@/server/modules/intelligence/intelligence.service";

export const BACKLOG_SELECTION_VERSION = "candidate_selection_v3";
export const BACKLOG_MAX_ATTEMPTS = 3;
export const BACKLOG_BATCH_SIZE = 5;

const rowSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), product_id: z.string().uuid(),
  conversation_id: z.string().uuid(), source_item_id: z.string().uuid(), demand_profile_id: z.string().uuid(),
  selection_version: z.string(), selection_fingerprint: z.string().regex(/^[0-9a-f]{64}$/), conversation_content_hash: z.string(), source_content_hash: z.string(),
  classifier_engine_version_id: z.string().uuid(), matcher_engine_version_id: z.string().uuid(),
  grounding_enabled: z.boolean(), selection_provenance: z.array(z.unknown()),
  status: z.enum(["pending", "processing", "retryable", "succeeded", "skipped", "exhausted"]),
  attempt_count: z.number().int(), leased_at: z.string().nullable(), lease_owner: z.string().uuid().nullable(),
  priority_score: z.coerce.number(), selection_rank: z.number().int(), created_at: z.string(), available_at: z.string(),
});
export type BacklogRow = z.infer<typeof rowSchema>;

// The generated Database type is updated only after a migration is applied. Parse this
// private table's boundary explicitly instead of weakening the global generated schema.
function db(client: SupabaseClient<Database>): SupabaseClient { return client as unknown as SupabaseClient; }
function fail(_error: { message: string } | null, operation: string): never {
  throw new Error(`Evaluation backlog ${operation} failed.`);
}

export function backlogFingerprint(input: {
  productId: string; productName: string; profileId: string; conversation: ConversationRow; source: SourceItemRow;
  classifierVersionId: string; matcherVersionId: string; groundingEnabled: boolean; provenance: ScanDiscoveryProvenance[];
}): string {
  const evidence = input.provenance.map(({ conversationId, queryPlanId, ...rest }) => {
    void conversationId;
    void queryPlanId;
    return rest;
  });
  return sha256Json({
    version: BACKLOG_SELECTION_VERSION,
    evaluationFingerprintVersion: PRODUCT_MATCH_EVALUATION_FINGERPRINT_VERSION,
    qualificationVersion: SIGNAL_QUALIFICATION_VERSION,
    thresholdVersion: SIGNAL_QUALIFICATION_THRESHOLD_VERSION,
    productId: input.productId, productName: input.productName, profileId: input.profileId,
    conversationId: input.conversation.id, conversationHash: input.conversation.content_hash,
    sourceId: input.source.id, sourceHash: input.source.content_hash,
    classifierVersionId: input.classifierVersionId, matcherVersionId: input.matcherVersionId,
    groundingEnabled: input.groundingEnabled,
    evidence: evidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

export async function hasEquivalentEvaluation(client: SupabaseClient<Database>, input: {
  productId: string; conversation: ConversationRow; profileId: string; classifierVersionId: string;
  matcherVersionId: string; groundingEnabled: boolean;
}): Promise<boolean> {
  // The canonical evaluation fingerprint is output-derived. This input-side check
  // excludes known completed deterministic work (including the seven measured roots),
  // while matchProduct's unique fingerprint remains the final replay authority.
  // Persisted historical qualifications do not record the grounding toggle.
  // Treat a completed current-version evaluation as complete rather than
  // requeueing the seven already measured roots for signal materialization.
  void input.groundingEnabled;
  const analysisFingerprint = sha256Json({ conversationId: input.conversation.id, contentHash: input.conversation.content_hash, engineVersionId: input.classifierVersionId });
  const analysis = await client.from("conversation_analysis").select("id").eq("conversation_id", input.conversation.id).eq("engine_version_id", input.classifierVersionId).eq("input_fingerprint", analysisFingerprint).maybeSingle();
  if (analysis.error) fail(analysis.error, "analysis read");
  if (!analysis.data) return false;
  const evaluation = await client.from("product_match_evaluations").select("id").eq("product_id", input.productId)
    .eq("conversation_id", input.conversation.id).eq("demand_profile_id", input.profileId)
    .eq("conversation_analysis_id", analysis.data.id).eq("match_engine_version_id", input.matcherVersionId)
    .contains("evidence", { qualification: { version: SIGNAL_QUALIFICATION_VERSION,
      diagnostics: { threshold_version: SIGNAL_QUALIFICATION_THRESHOLD_VERSION } } }).limit(1).maybeSingle();
  if (evaluation.error) fail(evaluation.error, "evaluation read");
  return Boolean(evaluation.data);
}

export async function enqueueCapSuppressed(client: SupabaseClient<Database>, input: {
  productId: string; productName: string; workspaceId: string; profileId: string; jobRunId?: string;
  classifierVersionId: string; matcherVersionId: string; groundingEnabled: boolean;
  candidates: Array<{ conversation: ConversationRow; source: SourceItemRow; score: number; rank: number; provenance: ScanDiscoveryProvenance[] }>;
}): Promise<number> {
  let inserted = 0;
  for (const candidate of input.candidates) {
    if (await hasEquivalentEvaluation(client, { productId: input.productId, conversation: candidate.conversation, profileId: input.profileId,
      classifierVersionId: input.classifierVersionId, matcherVersionId: input.matcherVersionId, groundingEnabled: input.groundingEnabled })) continue;
    const fingerprint = backlogFingerprint({ productId: input.productId, productName: input.productName,
      profileId: input.profileId, conversation: candidate.conversation, source: candidate.source,
      classifierVersionId: input.classifierVersionId, matcherVersionId: input.matcherVersionId,
      groundingEnabled: input.groundingEnabled, provenance: candidate.provenance });
    const result = await db(client).from("evaluation_backlog").upsert({
      workspace_id: input.workspaceId, product_id: input.productId, conversation_id: candidate.conversation.id,
      source_item_id: candidate.source.id, demand_profile_id: input.profileId, originating_job_run_id: input.jobRunId ?? null,
      selection_version: BACKLOG_SELECTION_VERSION, selection_fingerprint: fingerprint,
      conversation_content_hash: candidate.conversation.content_hash, source_content_hash: candidate.source.content_hash,
      classifier_engine_version_id: input.classifierVersionId, matcher_engine_version_id: input.matcherVersionId,
      grounding_enabled: input.groundingEnabled, selection_provenance: candidate.provenance,
      priority_score: candidate.score, selection_rank: candidate.rank,
    }, { onConflict: "workspace_id,product_id,conversation_id,demand_profile_id,selection_fingerprint", ignoreDuplicates: true }).select("id");
    if (result.error) fail(result.error, "enqueue");
    inserted += result.data?.length ?? 0;
  }
  return inserted;
}

export async function claimBacklog(client: SupabaseClient<Database>, owner: string, limit = BACKLOG_BATCH_SIZE): Promise<BacklogRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Invalid backlog batch limit.");
  const result = await db(client).rpc("claim_evaluation_backlog", { p_owner: owner, p_limit: limit });
  if (result.error) fail(result.error, "claim");
  return z.array(rowSchema).parse(result.data ?? []);
}

export async function settleBacklog(client: SupabaseClient<Database>, row: BacklogRow, owner: string, outcome: {
  status: "succeeded" | "skipped" | "retryable" | "exhausted"; code?: string; evaluationId?: string; signalId?: string | null;
}): Promise<void> {
  const now = new Date();
  const status = outcome.status === "retryable" && row.attempt_count >= BACKLOG_MAX_ATTEMPTS ? "exhausted" : outcome.status;
  const delayMs = Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, row.attempt_count - 1));
  const update = {
    status, leased_at: null, lease_owner: null, updated_at: now.toISOString(),
    available_at: status === "retryable" ? new Date(now.getTime() + delayMs).toISOString() : row.available_at,
    completed_at: status === "retryable" ? null : now.toISOString(),
    last_error_code: outcome.code ?? null,
    evaluation_id: outcome.evaluationId ?? null, signal_id: outcome.signalId ?? null,
  };
  const result = await db(client).from("evaluation_backlog").update(update).eq("id", row.id)
    .eq("workspace_id", row.workspace_id).eq("lease_owner", owner).eq("status", "processing").select("id").maybeSingle();
  if (result.error || !result.data) fail(result.error, "settlement or stale lease");
}

export async function nextBacklogWake(client: SupabaseClient<Database>): Promise<string | null> {
  const pending = await db(client).from("evaluation_backlog").select("available_at")
    .in("status", ["pending", "retryable"]).order("available_at", { ascending: true }).limit(1).maybeSingle();
  if (pending.error) fail(pending.error, "pending read");
  const processing = await db(client).from("evaluation_backlog").select("leased_at")
    .eq("status", "processing").order("leased_at", { ascending: true }).limit(1).maybeSingle();
  if (processing.error) fail(processing.error, "lease read");
  const next = [pending.data?.available_at, processing.data?.leased_at ? new Date(Date.parse(processing.data.leased_at) + 20 * 60_000).toISOString() : null]
    .filter((value): value is string => typeof value === "string").sort()[0];
  return next ?? null;
}
