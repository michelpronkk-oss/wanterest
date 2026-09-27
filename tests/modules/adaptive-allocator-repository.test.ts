import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADAPTIVE_ALLOCATOR_HISTORY_ROW_LIMIT, adaptiveAllocatorHistoryBounds, listAdaptiveAllocatorHistory } from "../../src/server/modules/operations/adaptive-allocator.repository";

describe("adaptive allocator history repository", () => {
  it("uses a bounded recent workspace/product query and excludes evidence bodies", async () => {
    const calls: string[] = [];
    const query = {
      select(columns: string) { calls.push(`select:${columns}`); return this; },
      eq(field: string, value: unknown) { calls.push(`eq:${field}:${String(value)}`); return this; },
      gte(field: string, value: unknown) { calls.push(`gte:${field}:${String(value)}`); return this; },
      order(field: string, options: { ascending: boolean }) { calls.push(`order:${field}:${options.ascending}`); return this; },
      limit: async (value: number) => ({ data: [{ query_plan_id: "q1", source_key: "github", query_family: "pain", demand_surface: "pain_first", market_partition_key: "p1", created_at: "2026-09-27T00:00:00.000Z", execution_status: "completed_with_results", pages_requested: 1, normalized_items: 2, unique_conversations: 1, duplicate_count: 0, selected_count: 1, evaluated_count: 1, qualified_influenced_count: 1, estimated_cost_usd: null }], error: null, limit: value }),
    };
    const result = await listAdaptiveAllocatorHistory({ client: { from: () => query }, workspaceId: "workspace", productId: "product", now: new Date("2026-09-27T00:00:00.000Z") });
    expect(calls.some((call) => call.includes("body"))).toBe(false);
    expect(calls).toContain("eq:workspace_id:workspace");
    expect(calls).toContain("eq:product_id:product");
    expect(calls).toContain("order:created_at:false");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].qualifiedInfluencedCount).toBe(1);
    expect(ADAPTIVE_ALLOCATOR_HISTORY_ROW_LIMIT).toBe(512);
    expect(adaptiveAllocatorHistoryBounds(new Date("2026-09-27T00:00:00.000Z")).windowDays).toBe(90);
  });
});
