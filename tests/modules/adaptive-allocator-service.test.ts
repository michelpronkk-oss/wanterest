import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareAdaptiveAllocator } from "../../src/server/modules/operations/adaptive-allocator.service";
import type { AdaptiveAllocatorSourceState } from "../../src/server/modules/operations/adaptive-allocator.schemas";
import type { QueryPlan } from "../../src/server/modules/operations/query-planning.schemas";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";

const sourceStates: AdaptiveAllocatorSourceState[] = [{ sourceKey: "github", configured: true, controlState: "enabled", healthStatus: "healthy" }];

const plan: QueryPlan = {
  version: "query_planning_v8",
  product_id: productId,
  demand_profile_version: "demand_profile_v2",
  source_routing_version: "source_routing_v1",
  scan_mode: "manual",
  overall_confidence: 0.8,
  source_plans: [{
    source_key: "github",
    priority: "high",
    candidate_budget: 2,
    query_budget: 1,
    queries: [{
      query_id: "q-github",
      source_key: "github",
      query_family: "pain",
      demand_surface: "pain_first",
      competitor_specific: false,
      intent_type: "problem_solution_search",
      query_text: "fixture",
      normalized_query: "fixture",
      priority: "high",
      confidence: 0.8,
      candidate_budget: 2,
      reason_codes: [],
      reason_summary: "fixture",
      concept_keys: ["pain"],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "free_low",
      metadata: { planner_version: "query_planning_v8" },
    }],
    excluded_query_families: [],
    reason_codes: [],
    confidence: 0.8,
  }],
  diagnostics: {
    source_count: 1,
    query_count: 1,
    query_family_distribution: { pain: 1 },
    demand_surface_coverage: { pain_first: "covered" },
    queries_per_source: { github: 1 },
    candidate_budget_per_source: { github: 2 },
    suppressed_duplicate_count: 0,
    low_confidence: false,
    messages: [],
  },
};

function clientWith(result: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: async () => result,
  };
  return { from: () => chain };
}

describe("adaptive allocator runtime contract", () => {
  it("keeps the baseline and avoids history reads when off", async () => {
    const result = await prepareAdaptiveAllocator({
      client: clientWith({ data: null, error: { message: "must not read" } }),
      workspaceId,
      productId,
      plan,
      sourceStates,
      rotationSeed: "scan-1",
      env: { ADAPTIVE_ALLOCATOR_MODE: "shadow", ADAPTIVE_ALLOCATOR_WORKSPACE_IDS: "different-workspace" },
    });

    expect(result.mode).toBe("off");
    expect(result.plan).toEqual(plan);
    expect(result.telemetry.mode).toBe("off");
    expect(result.telemetry.historyRowsRead).toBe(0);
  });

  it("keeps shadow mode safe when bounded history read fails", async () => {
    const result = await prepareAdaptiveAllocator({
      client: clientWith({ data: null, error: { message: "temporary history failure" } }),
      workspaceId,
      productId,
      plan,
      sourceStates,
      rotationSeed: "scan-1",
      env: { ADAPTIVE_ALLOCATOR_MODE: "shadow", ADAPTIVE_ALLOCATOR_WORKSPACE_IDS: workspaceId },
    });

    expect(result.mode).toBe("shadow");
    expect(result.plan).toEqual(plan);
    expect(result.telemetry.errors).toEqual(["History read failed: Adaptive allocator history lookup failed: temporary history failure"]);
    expect(result.telemetry.warnings).toContain("Shadow mode preserved baseline allocation after a bounded history-read failure.");
  });

  it("fails closed in active mode when history cannot be read", async () => {
    await expect(prepareAdaptiveAllocator({
      client: clientWith({ data: null, error: { message: "active history failure" } }),
      workspaceId,
      productId,
      plan,
      sourceStates,
      rotationSeed: "scan-1",
      env: { ADAPTIVE_ALLOCATOR_MODE: "active", ADAPTIVE_ALLOCATOR_WORKSPACE_IDS: workspaceId },
    })).rejects.toThrow("Adaptive allocator history lookup failed: active history failure");
  });
});
