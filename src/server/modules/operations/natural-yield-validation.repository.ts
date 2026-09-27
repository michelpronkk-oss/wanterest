import "server-only";

import { buildNaturalYieldReport } from "./natural-yield-validation.service";
import {
  NATURAL_YIELD_MAX_DAYS,
  NATURAL_YIELD_MAX_ROWS,
  type NaturalYieldEvaluationRow,
  type NaturalYieldInput,
  type NaturalYieldJobRow,
  type NaturalYieldQueryRow,
  type NaturalYieldReport,
  type NaturalYieldSignalRow,
  type NaturalYieldSourceHealthRow,
} from "./natural-yield-validation.schemas";

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type QueryResult = { data: Row[] | null; error: ErrorResult };
type Query = {
  select(columns: string): Query;
  eq(field: string, value: unknown): Query;
  gte(field: string, value: unknown): Query;
  lt(field: string, value: unknown): Query;
  order(field: string, options: { ascending: boolean }): Query;
  limit(count: number): Promise<QueryResult>;
};
type RpcResult = { data: unknown; error: ErrorResult };
type Client = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> };

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function numberValue(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function nullableNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null; }
function errorMessage(error: ErrorResult, context: string): Error { return new Error(`${context}${error?.code ? ` (${error.code})` : ""}: ${(error?.message ?? "unknown error").slice(0, 180)}`); }
function assertWindow(since: string, until: string): void {
  const start = new Date(since).getTime(); const end = new Date(until).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > NATURAL_YIELD_MAX_DAYS * 86_400_000) throw new Error(`Natural yield window must be increasing and at most ${NATURAL_YIELD_MAX_DAYS} days.`);
}

function mapQuery(row: Row): NaturalYieldQueryRow {
  return {
    jobRunId: stringValue(row.job_run_id), createdAt: stringValue(row.created_at), queryPlanId: stringValue(row.query_plan_id), sourceKey: stringValue(row.source_key),
    queryFamily: stringValue(row.query_family), demandSurface: stringValue(row.demand_surface), marketPartitionKey: nullableString(row.market_partition_key), executionStatus: stringValue(row.execution_status),
    pagesRequested: Math.max(1, numberValue(row.pages_requested)), pagesCompleted: numberValue(row.pages_completed), rawItems: numberValue(row.raw_items), rawNewItems: nullableNumber(row.raw_new_items),
    normalizedItems: numberValue(row.normalized_items), uniqueConversations: numberValue(row.unique_conversations), duplicateCount: numberValue(row.duplicate_count),
    sourceBudgetSuppressedCount: numberValue(row.source_budget_suppressed_count), candidateBudgetSuppressedCount: numberValue(row.candidate_budget_suppressed_count), evaluationCapSuppressedCount: numberValue(row.evaluation_cap_suppressed_count),
    selectedCount: numberValue(row.selected_count), evaluatedCount: numberValue(row.evaluated_count), qualifiedInfluencedCount: numberValue(row.qualified_influenced_count), weakInfluencedCount: numberValue(row.weak_influenced_count), rejectedInfluencedCount: numberValue(row.rejected_influenced_count), estimatedCostUsd: nullableNumber(row.estimated_cost_usd),
  };
}

function mapJob(row: Row): NaturalYieldJobRow {
  return { id: stringValue(row.id), createdAt: stringValue(row.created_at), completedAt: nullableString(row.completed_at), status: stringValue(row.status), inputReference: row.input_reference };
}

function mapEvaluation(row: Row): NaturalYieldEvaluationRow {
  return { id: stringValue(row.id), conversationId: stringValue(row.conversation_id), decision: stringValue(row.decision), createdAt: stringValue(row.created_at) };
}

function mapSignal(row: Row): NaturalYieldSignalRow {
  return { id: stringValue(row.id), conversationId: stringValue(row.conversation_id), createdAt: stringValue(row.created_at), lifecycleStatus: stringValue(row.lifecycle_status) };
}

function mapHealth(row: Row): NaturalYieldSourceHealthRow {
  return { sourceKey: stringValue(row.source_key), environment: stringValue(row.environment), degradationState: stringValue(row.degradation_state), lastSuccessAt: nullableString(row.last_success_at), lastFailureAt: nullableString(row.last_failure_at), latestErrorCode: nullableString(row.latest_error_code) };
}

function qualifiedTotal(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const qualified = (value as Record<string, unknown>).qualifiedEvidence;
  if (!qualified || typeof qualified !== "object" || Array.isArray(qualified)) return null;
  const total = (qualified as Record<string, unknown>).grossTotal;
  return typeof total === "number" && Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null;
}

/** Read-only, bounded production telemetry loader. It never selects evidence bodies or provider payloads. */
export class NaturalYieldValidationRepository {
  constructor(private readonly client: unknown) {}

  async load(input: { since: string; until: string; workspaceId: string; productId: string; }): Promise<NaturalYieldInput> {
    assertWindow(input.since, input.until);
    const client = this.client as Client;
    const query = client.from("query_yield_artifacts").select("job_run_id,created_at,query_plan_id,source_key,query_family,demand_surface,market_partition_key,execution_status,pages_requested,pages_completed,raw_items,raw_new_items,normalized_items,unique_conversations,duplicate_count,source_budget_suppressed_count,candidate_budget_suppressed_count,evaluation_cap_suppressed_count,selected_count,evaluated_count,qualified_influenced_count,weak_influenced_count,rejected_influenced_count,estimated_cost_usd").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).gte("created_at", input.since).lt("created_at", input.until).order("created_at", { ascending: true });
    const jobs = client.from("job_runs").select("id,created_at,completed_at,status,input_reference").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).eq("job_type", "discover-source").gte("created_at", input.since).lt("created_at", input.until).order("created_at", { ascending: true });
    const evaluations = client.from("product_match_evaluations").select("id,conversation_id,decision,created_at").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).gte("created_at", input.since).lt("created_at", input.until).order("created_at", { ascending: true });
    const signals = client.from("signals").select("id,conversation_id,created_at,lifecycle_status").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).gte("created_at", input.since).lt("created_at", input.until).order("created_at", { ascending: true });
    const health = client.from("source_health").select("source_key,environment,degradation_state,last_success_at,last_failure_at,latest_error_code").eq("environment", "production").order("source_key", { ascending: true });
    const [queryResult, jobResult, evaluationResult, signalResult, healthResult, funnelResult] = await Promise.all([
      query.limit(NATURAL_YIELD_MAX_ROWS), jobResultLimit(jobs), evaluationResultLimit(evaluations), signalResultLimit(signals), health.limit(100), client.rpc("signal_supply_funnel", { p_since: input.since, p_until: input.until, p_workspace_id: input.workspaceId, p_product_id: input.productId }),
    ]);
    if (queryResult.error) throw errorMessage(queryResult.error, "Natural yield query artifact lookup failed");
    if (jobResult.error) throw errorMessage(jobResult.error, "Natural yield job lookup failed");
    if (evaluationResult.error) throw errorMessage(evaluationResult.error, "Natural yield evaluation lookup failed");
    if (signalResult.error) throw errorMessage(signalResult.error, "Natural yield signal lookup failed");
    if (healthResult.error) throw errorMessage(healthResult.error, "Natural yield source health lookup failed");
    if (funnelResult.error) throw errorMessage(funnelResult.error, "Natural yield qualified evidence lookup failed");
    return {
      since: input.since, until: input.until, workspaceId: input.workspaceId, productId: input.productId,
      queries: (queryResult.data ?? []).map(mapQuery).filter((row) => row.jobRunId && row.queryPlanId),
      jobs: (jobResult.data ?? []).map(mapJob).filter((row) => row.id),
      evaluations: (evaluationResult.data ?? []).map(mapEvaluation).filter((row) => row.id && row.conversationId),
      signals: (signalResult.data ?? []).map(mapSignal).filter((row) => row.id),
      sourceHealth: (healthResult.data ?? []).map(mapHealth).filter((row) => row.sourceKey),
      qualifiedEvidenceTotal: qualifiedTotal(funnelResult.data),
    };
  }
}

async function jobResultLimit(query: Query): Promise<QueryResult> { return query.limit(NATURAL_YIELD_MAX_ROWS); }
async function evaluationResultLimit(query: Query): Promise<QueryResult> { return query.limit(NATURAL_YIELD_MAX_ROWS); }
async function signalResultLimit(query: Query): Promise<QueryResult> { return query.limit(NATURAL_YIELD_MAX_ROWS); }

export async function loadNaturalYieldReport(input: { client: unknown; since: string; until: string; workspaceId: string; productId: string; }): Promise<NaturalYieldReport> {
  const repository = new NaturalYieldValidationRepository(input.client);
  return buildNaturalYieldReport(await repository.load(input));
}
