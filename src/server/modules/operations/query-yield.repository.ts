import "server-only";

export type QueryYieldArtifact = {
  workspaceId: string; productId: string; jobRunId: string; queryPlanId: string;
  sourceKey: string; queryFamily: string; demandSurface: string; conceptKeys: string[]; competitorSpecific: boolean;
  retrievalWindow: Record<string, unknown>; pagesRequested: number; pagesCompleted: number; cursorContinuationCount: number;
  continuationStoppedReason: string; executionStatus: string; rawItems: number; normalizedItems: number; uniqueConversations: number;
  duplicateCount: number; sourceBudgetSuppressedCount: number; candidateBudgetSuppressedCount: number; evaluationCapSuppressedCount: number;
  selectedCount: number; evaluatedCount: number; qualifiedInfluencedCount: number; weakInfluencedCount: number; rejectedInfluencedCount: number; estimatedCostUsd: number | null;
  /** Stage 2B (observational): null when the query never executed or its source is ineligible. */
  marketPartitionKey?: string | null;
  marketPartitionIneligibleReason?: string | null;
  rawNewItems?: number | null;
  /** Stage 2D: product-relative provenance template for incremental matching. */
  discoveryProvenance?: Record<string, unknown> | null;
};

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type Query = { select(columns: string): Query; eq(field: string, value: unknown): Query; order(field: string, options: { ascending: boolean }): Promise<{ data: Row[] | null; error: ErrorResult }>; maybeSingle(): Promise<{ data: Row | null; error: ErrorResult }>; insert(row: Row): { select(columns: string): { maybeSingle(): Promise<{ data: Row | null; error: ErrorResult }> } } };
type Client = { from(table: "query_yield_artifacts"): Query };

/** Immutable query execution artifacts; callers must assemble final attribution before insertion. */
export class QueryYieldRepository {
  constructor(private readonly client: unknown) {}
  private table() { return (this.client as Client).from("query_yield_artifacts"); }
  private persistenceError(error: ErrorResult, context = "insert") {
    const code = error?.code ? ` (${error.code})` : "";
    const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
    return new Error(`Query yield artifact persistence failed during ${context}${code}${message}`);
  }
  async insertImmutable(input: QueryYieldArtifact): Promise<Row> {
    const row: Row = {
      workspace_id: input.workspaceId, product_id: input.productId, job_run_id: input.jobRunId, query_plan_id: input.queryPlanId,
      source_key: input.sourceKey, query_family: input.queryFamily, demand_surface: input.demandSurface, concept_keys: input.conceptKeys, competitor_specific: input.competitorSpecific,
      retrieval_window: input.retrievalWindow, pages_requested: input.pagesRequested, pages_completed: input.pagesCompleted, cursor_continuation_count: input.cursorContinuationCount,
      continuation_stopped_reason: input.continuationStoppedReason, execution_status: input.executionStatus, raw_items: input.rawItems, normalized_items: input.normalizedItems, unique_conversations: input.uniqueConversations,
      duplicate_count: input.duplicateCount, source_budget_suppressed_count: input.sourceBudgetSuppressedCount, candidate_budget_suppressed_count: input.candidateBudgetSuppressedCount, evaluation_cap_suppressed_count: input.evaluationCapSuppressedCount,
      selected_count: input.selectedCount, evaluated_count: input.evaluatedCount, qualified_influenced_count: input.qualifiedInfluencedCount, weak_influenced_count: input.weakInfluencedCount, rejected_influenced_count: input.rejectedInfluencedCount, estimated_cost_usd: input.estimatedCostUsd,
      market_partition_key: input.marketPartitionKey ?? null, market_partition_ineligible_reason: input.marketPartitionIneligibleReason ?? null, raw_new_items: input.rawNewItems ?? null,
      discovery_provenance: input.discoveryProvenance ?? null,
    };
    const { data, error } = await this.table().insert(row).select("*").maybeSingle();
    if (!error && data) return data;
    if (error?.code === "23505") {
      const { data: existing, error: lookupError } = await this.table().select("*").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).eq("job_run_id", input.jobRunId).eq("query_plan_id", input.queryPlanId).maybeSingle();
      if (!lookupError && existing) return existing;
    }
    throw this.persistenceError(error, error?.code === "23505" ? "duplicate lookup" : "insert");
  }
  async loadForScan(input: Pick<QueryYieldArtifact, "workspaceId" | "productId" | "jobRunId">) {
    const { data, error } = await this.table().select("*").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).eq("job_run_id", input.jobRunId).order("created_at", { ascending: true });
    if (error) throw new Error("Query yield artifact lookup failed.");
    return data ?? [];
  }
}
