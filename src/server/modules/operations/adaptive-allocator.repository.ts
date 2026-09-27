import "server-only";

import type { AdaptiveAllocatorHistoryRow } from "./adaptive-allocator.schemas";

const HISTORY_WINDOW_DAYS = 90;
const HISTORY_ROW_LIMIT = 512;

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null };
type Query = {
  select(columns: string): Query;
  eq(field: string, value: unknown): Query;
  gte(field: string, value: unknown): Query;
  order(field: string, options: { ascending: boolean }): Query;
  limit(count: number): Promise<QueryResult>;
};
type Client = { from(table: "query_yield_artifacts"): Query };

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function adaptiveAllocatorHistoryBounds(now = new Date()): { sinceIso: string; limit: number; windowDays: number } {
  const since = new Date(now.getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { sinceIso: since.toISOString(), limit: HISTORY_ROW_LIMIT, windowDays: HISTORY_WINDOW_DAYS };
}

/** Reads only bounded, workspace/product-scoped query-yield facts; no evidence bodies are loaded. */
export async function listAdaptiveAllocatorHistory(input: { client: unknown; workspaceId: string; productId: string; now?: Date }): Promise<{ rows: AdaptiveAllocatorHistoryRow[]; windowDays: number }> {
  const bounds = adaptiveAllocatorHistoryBounds(input.now);
  const query = (input.client as Client).from("query_yield_artifacts")
    .select("query_plan_id,source_key,query_family,demand_surface,market_partition_key,created_at,execution_status,pages_requested,normalized_items,unique_conversations,duplicate_count,selected_count,evaluated_count,qualified_influenced_count,estimated_cost_usd")
    .eq("workspace_id", input.workspaceId)
    .eq("product_id", input.productId)
    .gte("created_at", bounds.sinceIso)
    .order("created_at", { ascending: false });
  const result = await query.limit(bounds.limit);
  if (result.error) throw new Error(`Adaptive allocator history lookup failed: ${result.error.message ?? result.error.code ?? "unknown error"}`);
  return {
    windowDays: bounds.windowDays,
    rows: (result.data ?? []).map((row) => ({
      queryPlanId: stringValue(row.query_plan_id),
      sourceKey: stringValue(row.source_key),
      queryFamily: stringValue(row.query_family),
      demandSurface: stringValue(row.demand_surface),
      marketPartitionKey: typeof row.market_partition_key === "string" ? row.market_partition_key : null,
      createdAt: stringValue(row.created_at),
      executionStatus: stringValue(row.execution_status),
      pagesRequested: Math.max(1, Math.floor(numberValue(row.pages_requested))),
      normalizedItems: Math.floor(numberValue(row.normalized_items)),
      uniqueConversations: Math.floor(numberValue(row.unique_conversations)),
      duplicateCount: Math.floor(numberValue(row.duplicate_count)),
      selectedCount: Math.floor(numberValue(row.selected_count)),
      evaluatedCount: Math.floor(numberValue(row.evaluated_count)),
      qualifiedInfluencedCount: Math.floor(numberValue(row.qualified_influenced_count)),
      estimatedCostUsd: nullableNumber(row.estimated_cost_usd),
    })).filter((row) => row.queryPlanId && row.sourceKey),
  };
}

export const ADAPTIVE_ALLOCATOR_HISTORY_ROW_LIMIT = HISTORY_ROW_LIMIT;
export const ADAPTIVE_ALLOCATOR_HISTORY_WINDOW_DAYS = HISTORY_WINDOW_DAYS;
