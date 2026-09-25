import "server-only";

import type { InterestArtifact } from "./incremental-product-matching.policy";

/**
 * Wanterest 1B Stage 2D persistence. Service-role only (called from Trigger
 * tasks). Every workspace-owned read is filtered by BOTH workspace_id and
 * product_id taken from the interest artifact row itself - never from a task
 * payload - so a product can only ever receive evaluations under its own
 * workspace.
 */

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type Result<T> = Promise<{ data: T; error: ErrorResult }>;
type Filterable = {
  eq(field: string, value: unknown): Filterable;
  in(field: string, values: unknown[]): Filterable;
  gte(field: string, value: unknown): Filterable;
  not(field: string, operator: string, value: unknown): Filterable;
  order(field: string, options: { ascending: boolean }): Filterable;
  limit(count: number): Result<Row[] | null>;
  maybeSingle(): Result<Row | null>;
};
type UpdateQuery = { eq(field: string, value: unknown): { select(columns: string): { single(): Result<Row | null> } } };
type Query = {
  select(columns: string): Filterable;
  insert(row: Row): { select(columns: string): { single(): Result<Row | null> } };
  update(patch: Row): UpdateQuery;
};
type Client = { from(table: "job_runs" | "query_yield_artifacts" | "product_matches"): Query };

export type IncrementalJobType = "match-partition-incremental" | "match-product-incremental";

export type IncrementalJobRun = {
  id: string;
  status: string;
  attempt_count: number;
  input_reference: unknown;
};

export type RefreshJobRun = {
  id: string;
  status: string;
  input_reference: unknown;
};

function persistenceError(error: ErrorResult, context: string): Error {
  const code = error?.code ? ` (${error.code})` : "";
  const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
  return new Error(`Incremental product matching persistence failed during ${context}${code}${message}`);
}

export class IncrementalProductMatchingRepository {
  constructor(private readonly client: unknown) {}

  private table(name: "job_runs" | "query_yield_artifacts" | "product_matches"): Query {
    return (this.client as Client).from(name);
  }

  async getRefreshJob(refreshJobRunId: string): Promise<RefreshJobRun | null> {
    const { data, error } = await this.table("job_runs").select("id, status, input_reference").eq("id", refreshJobRunId).eq("job_type", "refresh-market-partition").maybeSingle();
    if (error) throw persistenceError(error, "refresh job lookup");
    return (data as RefreshJobRun | null) ?? null;
  }

  async getJob(jobType: IncrementalJobType, idempotencyKey: string): Promise<IncrementalJobRun | null> {
    const { data, error } = await this.table("job_runs").select("id, status, attempt_count, input_reference").eq("job_type", jobType).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error) throw persistenceError(error, `${jobType} lookup`);
    return (data as IncrementalJobRun | null) ?? null;
  }

  /** Idempotent by unique (job_type, idempotency_key): a concurrent insert resolves to the existing row. */
  async startJob(input: { jobType: IncrementalJobType; idempotencyKey: string; traceId: string; workspaceId: string | null; productId: string | null; inputReference: Row }): Promise<IncrementalJobRun> {
    const startedAt = new Date().toISOString();
    const existing = await this.getJob(input.jobType, input.idempotencyKey);
    if (existing) {
      const { data, error } = await this.table("job_runs").update({ status: "running", attempt_count: existing.attempt_count + 1, started_at: startedAt, completed_at: null, error_code: null, error_details: null }).eq("id", existing.id).select("id, status, attempt_count, input_reference").single();
      if (error || !data) throw persistenceError(error, `${input.jobType} resume`);
      return data as IncrementalJobRun;
    }
    const { data, error } = await this.table("job_runs").insert({
      job_type: input.jobType,
      workspace_id: input.workspaceId,
      product_id: input.productId,
      idempotency_key: input.idempotencyKey,
      input_reference: input.inputReference,
      status: "running",
      attempt_count: 1,
      started_at: startedAt,
      trace_id: input.traceId.slice(0, 120),
    }).select("id, status, attempt_count, input_reference").single();
    if (!error && data) return data as IncrementalJobRun;
    if (error?.code === "23505") {
      const raced = await this.getJob(input.jobType, input.idempotencyKey);
      if (raced) return raced;
    }
    throw persistenceError(error, `${input.jobType} creation`);
  }

  async completeJob(jobId: string, input: { status: "succeeded" | "failed"; inputReference: Row; errorMessage?: string }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.table("job_runs").update({
      status: input.status,
      input_reference: input.inputReference,
      completed_at: now,
      terminal_at: now,
      error_code: input.status === "failed" ? "INCREMENTAL_MATCH_FAILED" : null,
      error_details: input.errorMessage ? { message: input.errorMessage.slice(0, 500) } : null,
    }).eq("id", jobId).select("id").single();
    if (error) throw persistenceError(error, "job completion");
  }

  async listInterestArtifacts(partitionKey: string, sinceIso: string, limit: number): Promise<InterestArtifact[]> {
    const { data, error } = await this.table("query_yield_artifacts")
      .select("id, workspace_id, product_id, job_run_id, query_plan_id, source_key, created_at, discovery_provenance")
      .eq("market_partition_key", partitionKey)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw persistenceError(error, "interest lookup");
    return (data ?? []).map((row) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      productId: row.product_id as string,
      jobRunId: row.job_run_id as string,
      queryPlanId: row.query_plan_id as string,
      sourceKey: row.source_key as string,
      createdAt: row.created_at as string,
      discoveryProvenance: row.discovery_provenance ?? null,
    }));
  }

  async listMatchedConversationIds(input: { workspaceId: string; productId: string; conversationIds: string[] }): Promise<Set<string>> {
    if (!input.conversationIds.length) return new Set();
    const { data, error } = await this.table("product_matches")
      .select("conversation_id")
      .eq("workspace_id", input.workspaceId)
      .eq("product_id", input.productId)
      .in("conversation_id", input.conversationIds)
      .limit(input.conversationIds.length);
    if (error) throw persistenceError(error, "existing match lookup");
    return new Set((data ?? []).map((row) => row.conversation_id as string));
  }
}
