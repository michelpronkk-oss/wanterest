import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { boundMonitoringRequests } from "../../src/server/modules/onboarding/initial-scan.service";
import { PLAN_CAPABILITIES, getProviderBudget } from "../../src/server/modules/entitlements/plan-capabilities";
import { aggregateSourceHealthV1 } from "../../src/server/modules/operations/source-health-aggregation";
import { getInternalXQueryBudgetOverride, INTERNAL_X_MAX_QUERIES_HARD_CAP } from "../../src/server/providers/source/x/x.internal";
import { XSourceAdapter } from "../../src/server/providers/source/x";
import { X_PROVIDER_MIN_RESULTS, estimateXReadCost } from "../../src/server/providers/source/x/x.cost";
import { SIGNAL_QUALIFICATION_THRESHOLD_VERSION, SIGNAL_QUALIFICATION_VERSION } from "../../src/server/modules/intelligence/signal-qualification.config";
import { SEMANTIC_REASONING_ROUTER_VERSION } from "../../src/server/modules/intelligence/semantic-reasoning-router";
import { queryPlanningVersion } from "../../src/server/modules/operations/query-planning.schemas";

const internalWorkspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
const normalWorkspaceId = "00000000-0000-4000-8000-000000000001";

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function plannedXRequests() {
  return ["pain_first", "competitor_pain", "feature_demand"].map((surface, index) => ({
    query: `query-${index + 1}`,
    limit: 3,
    expandThreads: false,
    requestMetadata: { demandSurface: surface },
  }));
}

describe("Signal Yield V1 controlled X budget expansion", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("INTERNAL_X_DISCOVERY_WORKSPACE_IDS", internalWorkspaceId);
    vi.stubEnv("INTERNAL_X_MAX_POSTS_PER_SCAN", "10");
    vi.stubEnv("INTERNAL_X_MAX_QUERIES_PER_SCAN", "3");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows exactly the three planned X queries only for the internal workspace", () => {
    expect(getInternalXQueryBudgetOverride(internalWorkspaceId)).toEqual({ workspaceId: internalWorkspaceId, maxQueriesPerScan: 3 });
    expect(getInternalXQueryBudgetOverride(normalWorkspaceId)).toBeNull();
    expect(INTERNAL_X_MAX_QUERIES_HARD_CAP).toBe(3);

    const internal = boundMonitoringRequests(plannedXRequests(), "x", "manual", null, PLAN_CAPABILITIES.free, internalWorkspaceId);
    const normal = boundMonitoringRequests(plannedXRequests(), "x", "manual", null, PLAN_CAPABILITIES.free, normalWorkspaceId);
    const nonX = boundMonitoringRequests(plannedXRequests(), "github", "manual", null, PLAN_CAPABILITIES.free, internalWorkspaceId);

    expect(internal).toHaveLength(3);
    expect(normal).toHaveLength(2);
    expect(nonX).toHaveLength(3);
    expect(internal.every((request) => request.requestMetadata.maxPages === 1)).toBe(true);
    expect(internal.map((request) => request.query)).toEqual(["query-1", "query-2", "query-3"]);
    expect(getProviderBudget(PLAN_CAPABILITIES.free, "x", "manual_standard").maxQueriesPerScan).toBe(2);
    expect(getProviderBudget(PLAN_CAPABILITIES.free, "github", "manual_standard").maxQueriesPerScan).toBe(4);
  });

  it("executes three bounded X requests at the existing provider-minimum page and cost", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: [], meta: { result_count: 0 } }));
    const adapter = new XSourceAdapter({ fetchImpl, token: "test-token" });
    const requests = boundMonitoringRequests(plannedXRequests(), "x", "manual", null, PLAN_CAPABILITIES.free, internalWorkspaceId)
      .map((request) => ({
        ...request,
        requestMetadata: { ...request.requestMetadata, internalWorkspaceId, maxResults: request.limit, maxBillablePostsPerDiscovery: request.limit },
      }));

    const pages = await Promise.all(requests.map((request) => adapter.discover(request)));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => page.items.length === 0 && page.estimatedCost === 0.05)).toBe(true);
    expect(pages.reduce((sum, page) => sum + (page.estimatedCost ?? 0), 0)).toBeCloseTo(0.15, 10);
    expect(estimateXReadCost(3 * X_PROVIDER_MIN_RESULTS)).toBe(0.15);
    for (const call of fetchImpl.mock.calls) {
      const requested = new URL(String(call[0]));
      expect(requested.searchParams.get("max_results")).toBe(String(X_PROVIDER_MIN_RESULTS));
      expect(requested.searchParams.has("pagination_token")).toBe(false);
    }
  });

  it("reports three successful X executions as full healthy coverage, including zero results", () => {
    const result = aggregateSourceHealthV1({
      plannedSources: [{ sourceKey: "x", priority: "high", plannedQueries: 3 }],
      plannedQueries: ["x-1", "x-2", "x-3"].map((queryPlanId) => ({ queryPlanId, sourceKey: "x", priority: "high" })),
      executions: [
        { queryPlanId: "x-1", sourceKey: "x", executionStatus: "completed_with_results", normalizedItems: 2 },
        { queryPlanId: "x-2", sourceKey: "x", executionStatus: "completed_zero_results", normalizedItems: 0 },
        { queryPlanId: "x-3", sourceKey: "x", executionStatus: "completed_zero_results", normalizedItems: 0 },
      ],
    });

    expect(result.sources.x).toMatchObject({ plannedQueries: 3, executedQueries: 3, successfulQueries: 3, failedQueries: 0, budgetLimitedQueries: 0, coverageFraction: 1, partial: false });
  });

  it("keeps the frozen planner, qualification, and semantic-reasoning versions", () => {
    expect(queryPlanningVersion).toBe("query_planning_v7");
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SIGNAL_QUALIFICATION_THRESHOLD_VERSION).toBe("signal_qualification_thresholds_v1");
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v1");
  });
});
