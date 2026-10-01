import "server-only";

import { deterministicUuid } from "@/server/modules/ingestion/hash";
import type { QueryIntentFamily, QueryVariantVersion } from "./query-planning.schemas";

type Row = Record<string, unknown>;
type DatabaseError = { code?: string; message?: string } | null;
type DatabaseResult = { data: Row[] | null; error: DatabaseError };
type Query = {
  insert(values: Row | Row[]): Query;
  upsert(values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Query;
  select(columns?: string): Query;
  eq(field: string, value: unknown): Query;
  in(field: string, values: unknown[]): Query;
  limit(value: number): Query;
};
type Client = { from(table: "source_query_executions" | "source_query_execution_pages" | "source_query_result_attributions" | "product_query_result_outcomes"): Query };

async function execute(query: Query): Promise<DatabaseResult> {
  return await (query as unknown as PromiseLike<DatabaseResult>);
}

export type SourceQueryPageAttribution = {
  id: string;
  pageNumber: number;
  sourceJobRunId: string | null;
  cursorRequested: boolean;
  providerResultsReturned: number;
  rawSnapshotsAccepted: number;
  rawSnapshotsInserted: number;
  rawSnapshotsDuplicate: number;
  normalizedItems: number;
  uniqueProviderItems: number;
  duplicateProviderItems: number;
  uniqueRoots: number;
  duplicateRoots: number;
  continuationAvailable: boolean;
  continuationFollowed: boolean;
  stopReason: "continuation_followed" | "no_cursor" | "page_cap_reached" | "provider_limit" | "zero_results" | "error";
  rateLimitRemaining: number | null;
  retryAfterMs: number | null;
  attemptCount: number;
  durationMs: number;
  observedAt: string;
};

export type SourceQueryResultAttribution = {
  id: string;
  pageId: string;
  resultOrdinal: number;
  rawSourceItemId: string;
  sourceItemId: string | null;
  conversationId: string | null;
  rawSnapshotInserted: boolean | null;
  firstProviderItemInExecution: boolean;
  firstRootInExecution: boolean;
};

export type SourceQueryExecutionAttribution = {
  id: string;
  executionKey: string;
  parentJobRunId: string;
  /** Hash of the plan identifier; plan IDs may contain normalized private query text. */
  queryPlanFingerprint: string;
  sourceKey: string;
  queryFamily: string;
  intentFamily: QueryIntentFamily;
  queryVariantVersion: QueryVariantVersion;
  demandSurface: string;
  pagesRequested: number;
  pagesCompleted: number;
  continuationCount: number;
  stopReason: "no_cursor" | "page_cap_reached" | "provider_limit" | "zero_results" | "error";
  executionStatus: "completed_with_results" | "completed_zero_results" | "rate_limited" | "provider_error" | "budget_limited" | "execution_suppressed" | "disabled" | "unavailable" | "degraded";
  providerResultsReturned: number;
  rawSnapshotsAccepted: number;
  rawSnapshotsInserted: number;
  rawSnapshotsDuplicate: number;
  uniqueProviderItems: number;
  duplicateProviderItems: number;
  normalizedItems: number;
  uniqueRoots: number;
  duplicateRoots: number;
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pages: SourceQueryPageAttribution[];
  results: SourceQueryResultAttribution[];
};

/** Persists bounded IDs and counts only. Provider queries, cursors and content never enter these rows. */
export async function persistSourceQueryExecution(clientValue: unknown, input: SourceQueryExecutionAttribution): Promise<void> {
  const client = clientValue as Client;
  const execution = await execute(client.from("source_query_executions").upsert({
    id: input.id,
    execution_key: input.executionKey,
    parent_job_run_id: input.parentJobRunId,
    query_plan_fingerprint: input.queryPlanFingerprint,
    source_key: input.sourceKey,
    query_family: input.queryFamily,
    intent_family: input.intentFamily,
    query_variant_version: input.queryVariantVersion,
    demand_surface: input.demandSurface,
    pages_requested: input.pagesRequested,
    pages_completed: input.pagesCompleted,
    continuation_count: input.continuationCount,
    stop_reason: input.stopReason,
    execution_status: input.executionStatus,
    provider_results_returned: input.providerResultsReturned,
    raw_snapshots_accepted: input.rawSnapshotsAccepted,
    raw_snapshots_inserted: input.rawSnapshotsInserted,
    raw_snapshots_duplicate: input.rawSnapshotsDuplicate,
    unique_provider_items: input.uniqueProviderItems,
    duplicate_provider_items: input.duplicateProviderItems,
    normalized_items: input.normalizedItems,
    unique_roots: input.uniqueRoots,
    duplicate_roots: input.duplicateRoots,
    error_code: input.errorCode,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    duration_ms: input.durationMs,
  }, { onConflict: "execution_key" }));
  if (execution.error) throw new Error(`Source execution telemetry aggregate could not be persisted (${execution.error.code ?? "database_error"}).`);

  if (input.pages.length) {
    const pages = await execute(client.from("source_query_execution_pages").upsert(input.pages.map((page) => ({
      id: page.id,
      execution_id: input.id,
      page_number: page.pageNumber,
      source_job_run_id: page.sourceJobRunId,
      cursor_requested: page.cursorRequested,
      provider_results_returned: page.providerResultsReturned,
      raw_snapshots_accepted: page.rawSnapshotsAccepted,
      raw_snapshots_inserted: page.rawSnapshotsInserted,
      raw_snapshots_duplicate: page.rawSnapshotsDuplicate,
      normalized_items: page.normalizedItems,
      unique_provider_items: page.uniqueProviderItems,
      duplicate_provider_items: page.duplicateProviderItems,
      unique_roots: page.uniqueRoots,
      duplicate_roots: page.duplicateRoots,
      continuation_available: page.continuationAvailable,
      continuation_followed: page.continuationFollowed,
      stop_reason: page.stopReason,
      rate_limit_remaining: page.rateLimitRemaining,
      retry_after_ms: page.retryAfterMs,
      attempt_count: page.attemptCount,
      duration_ms: page.durationMs,
      observed_at: page.observedAt,
    })), { onConflict: "execution_id,page_number" }));
    if (pages.error) throw new Error(`Source execution page telemetry could not be persisted (${pages.error.code ?? "database_error"}).`);
  }

  if (input.results.length) {
    const results = await execute(client.from("source_query_result_attributions").upsert(input.results.map((result) => ({
      id: result.id,
      page_id: result.pageId,
      result_ordinal: result.resultOrdinal,
      raw_source_item_id: result.rawSourceItemId,
      source_item_id: result.sourceItemId,
      conversation_id: result.conversationId,
      raw_snapshot_inserted: result.rawSnapshotInserted,
      first_provider_item_in_execution: result.firstProviderItemInExecution,
      first_root_in_execution: result.firstRootInExecution,
    })), { onConflict: "page_id,result_ordinal" }));
    if (results.error) throw new Error(`Source result attribution could not be persisted (${results.error.code ?? "database_error"}).`);
  }
}

export type ProductQueryResultOutcome = {
  sourceResultAttributionId: string;
  conversationId: string;
  workspaceId: string;
  productId: string;
  matchJobRunId: string;
  attemptNumber: number;
  selected: boolean;
  evaluated: boolean;
  qualificationStatus: "qualified" | "weak_candidate" | "rejected" | null;
  evaluationId: string | null;
  signalId: string | null;
  evidenceEligible?: boolean | null;
};

export async function persistProductQueryResultOutcomes(clientValue: unknown, rows: ProductQueryResultOutcome[]): Promise<void> {
  if (!rows.length) return;
  const client = clientValue as Client;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    const result = await execute(client.from("product_query_result_outcomes").upsert(chunk.map((row) => ({
      id: deterministicUuid(`product-query-result-outcome:${row.workspaceId}:${row.productId}:${row.matchJobRunId}:${row.attemptNumber}:${row.sourceResultAttributionId}`),
      source_query_result_attribution_id: row.sourceResultAttributionId,
      conversation_id: row.conversationId,
      workspace_id: row.workspaceId,
      product_id: row.productId,
      match_job_run_id: row.matchJobRunId,
      attempt_number: row.attemptNumber,
      selected: row.selected,
      evaluated: row.evaluated,
      qualification_status: row.qualificationStatus,
      product_match_evaluation_id: row.evaluationId,
      signal_id: row.signalId,
      evidence_eligible: row.evidenceEligible ?? null,
    })), { onConflict: "workspace_id,product_id,match_job_run_id,attempt_number,source_query_result_attribution_id", ignoreDuplicates: true }));
    if (result.error) throw new Error(`Product query outcome telemetry could not be persisted (${result.error.code ?? "database_error"}).`);
  }
}

/** Returns only stable attribution IDs for linking a later incremental match. */
export async function listQueryResultAttributionsForJob(clientValue: unknown, parentJobRunId: string, conversationIds: string[]): Promise<Array<{ id: string; conversationId: string }>> {
  if (!conversationIds.length) return [];
  const client = clientValue as Client;
  const executions = await execute(client.from("source_query_executions").select("id").eq("parent_job_run_id", parentJobRunId).limit(300));
  if (executions.error) throw new Error("Source execution attribution could not be loaded.");
  const executionIds = (executions.data ?? []).map((row) => row.id).filter((value): value is string => typeof value === "string");
  if (!executionIds.length) return [];
  const pages = await execute(client.from("source_query_execution_pages").select("id").in("execution_id", executionIds).limit(900));
  if (pages.error) throw new Error("Source execution page attribution could not be loaded.");
  const pageIds = (pages.data ?? []).map((row) => row.id).filter((value): value is string => typeof value === "string");
  if (!pageIds.length) return [];
  const results = await execute(client.from("source_query_result_attributions").select("id,conversation_id").in("page_id", pageIds).limit(5000));
  if (results.error) throw new Error("Source result attribution could not be loaded.");
  const allowed = new Set(conversationIds);
  return (results.data ?? []).flatMap((row) => typeof row.id === "string" && typeof row.conversation_id === "string" && allowed.has(row.conversation_id)
    ? [{ id: row.id, conversationId: row.conversation_id }]
    : []);
}

export function sourceExecutionId(key: string): string {
  return deterministicUuid(`source-query-execution:${key}`);
}

export function sourceExecutionPageId(executionId: string, pageNumber: number): string {
  return deterministicUuid(`source-query-execution-page:${executionId}:${pageNumber}`);
}

export function sourceResultAttributionId(pageId: string, resultOrdinal: number): string {
  return deterministicUuid(`source-query-result:${pageId}:${resultOrdinal}`);
}
