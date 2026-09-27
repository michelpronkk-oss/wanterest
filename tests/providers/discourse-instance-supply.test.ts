import { describe, expect, it } from "vitest";

import {
  DISCOURSE_INSTANCE_REGISTRY_V1,
  DISCOURSE_MAX_INSTANCES_PER_QUERY,
  DISCOURSE_MAX_QUERIES_PER_INSTANCE,
  DISCOURSE_INSTANCE_SUPPLY_VERSION,
  hasSelectableDiscourseInstanceSupply,
  selectDiscourseInstances,
  type DiscourseInstanceRegistryEntry,
} from "../../src/server/providers/source/discourse/instance-supply";
import { toSourceDiscoveryRequests, toSourceDiscoveryRequestsForPlan } from "../../src/server/modules/operations/query-planning.execution";

function entry(overrides: Partial<DiscourseInstanceRegistryEntry> = {}): DiscourseInstanceRegistryEntry {
  return {
    key: "example",
    baseUrl: "https://example.test",
    enabled: true,
    publicAccessible: true,
    semanticTags: ["project management", "workflow"],
    categoryTags: ["project management software"],
    topicTags: ["recommendation", "feature request"],
    language: "en",
    healthStatus: "healthy",
    lastSuccessAt: null,
    rationale: "test",
    ...overrides,
  };
}

describe("Discourse instance supply v1", () => {
  it("selects the curated public instance for semantically relevant product-management demand", () => {
    const selected = selectDiscourseInstances({
      query: {
        queryText: "project management software workflow",
        queryFamily: "recommendation",
        demandSurface: "category_demand",
        providerContext: { category: "project management software", audience: "software development teams" },
      },
    });

    expect(selected.map((item) => item.baseUrl)).toEqual(["https://forum.obsidian.md"]);
    expect(selected[0]).toMatchObject({ key: "forum-obsidian-md", healthStatus: "healthy", publicAccessible: true });
  });

  it("does not select unrelated, disabled, inaccessible, or unhealthy entries", () => {
    const selected = selectDiscourseInstances({
      query: { queryText: "project management workflow", providerContext: { category: "project management software" } },
      registry: [
        entry({ key: "healthy", baseUrl: "https://healthy.test" }),
        entry({ key: "disabled", baseUrl: "https://disabled.test", enabled: false }),
        entry({ key: "private", baseUrl: "https://private.test", publicAccessible: false }),
        entry({ key: "degraded", baseUrl: "https://degraded.test", healthStatus: "degraded" }),
        entry({ key: "unrelated", baseUrl: "https://unrelated.test", semanticTags: ["cooking"], categoryTags: ["recipes"], topicTags: ["recipes"] }),
      ],
    });

    expect(selected.map((item) => item.key)).toEqual(["healthy"]);
  });

  it("applies a deterministic hard cap and stable tie-break for multiple selected instances", () => {
    const registry = [
      entry({ key: "zeta", baseUrl: "https://zeta.test" }),
      entry({ key: "alpha", baseUrl: "https://alpha.test" }),
      entry({ key: "beta", baseUrl: "https://beta.test" }),
    ];
    const input = { query: { queryText: "project management workflow", providerContext: { category: "project management software" } }, registry };

    expect(selectDiscourseInstances(input).map((item) => item.key)).toEqual(["alpha", "beta"]);
    expect(selectDiscourseInstances({ ...input, maxInstances: 99 })).toHaveLength(DISCOURSE_MAX_INSTANCES_PER_QUERY);
  });

  it("expands planner V8 requests into explicit selected-instance metadata without changing depth bounds", () => {
    const query = {
      query_id: "q-discourse-project-management",
      query_family: "recommendation" as const,
      demand_surface: "category_demand" as const,
      competitor_specific: false,
      intent_type: "recommendation_request" as const,
      query_text: "project management software workflow",
      normalized_query: "project management software workflow",
      source_key: "discourse",
      priority: "high" as const,
      confidence: 0.9,
      candidate_budget: 6,
      reason_codes: [],
      reason_summary: "test",
      concept_keys: ["category"],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "free_rate_limited" as const,
      metadata: {
        planner_version: "query_planning_v8",
        provider_context: { category: "project management software", audience: "software development teams" },
      },
    };
    const requests = toSourceDiscoveryRequests({
      sourcePlan: { source_key: "discourse" } as never,
      query,
      maxPages: 2,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.requestMetadata).toMatchObject({
      discourseInstance: "https://forum.obsidian.md",
      discourseInstanceKey: "forum-obsidian-md",
      discourseInstanceSupplyVersion: DISCOURSE_INSTANCE_SUPPLY_VERSION,
      discourseV1: true,
      depthPolicyVersion: "discourse_depth_v1",
      maxDepthTopicsPerPage: 3,
      maxPostsPerTopic: 8,
      maxDepthPages: 2,
      maxDepthRequests: 12,
    });
  });

  it("keeps the per-instance query cap when a source plan contains more queries than the bound", () => {
    const query = {
      query_id: "q-discourse-project-management",
      query_family: "recommendation" as const,
      demand_surface: "category_demand" as const,
      competitor_specific: false,
      intent_type: "recommendation_request" as const,
      query_text: "project management software workflow",
      normalized_query: "project management software workflow",
      source_key: "discourse",
      priority: "high" as const,
      confidence: 0.9,
      candidate_budget: 6,
      reason_codes: [],
      reason_summary: "test",
      concept_keys: ["category"],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "free_rate_limited" as const,
      metadata: { planner_version: "query_planning_v8", provider_context: { category: "project management software" } },
    };
    const requests = toSourceDiscoveryRequestsForPlan({ sourcePlan: { source_key: "discourse", queries: [query, { ...query, query_id: "q2", query_text: "project management workflow pain" }, { ...query, query_id: "q3", query_text: "project management feature request" }, { ...query, query_id: "q4", query_text: "project management recommendation" }] } as never, maxPages: 2 });

    const counts = new Map<string, number>();
    for (const request of requests) {
      const instance = String(request.requestMetadata?.discourseInstance);
      counts.set(instance, (counts.get(instance) ?? 0) + 1);
    }
    expect([...counts.values()].every((count) => count <= DISCOURSE_MAX_QUERIES_PER_INSTANCE)).toBe(true);
    expect(requests).toHaveLength(DISCOURSE_MAX_QUERIES_PER_INSTANCE);
  });

  it("keeps the curated registry server-owned and selectable without an environment URL", () => {
    expect(DISCOURSE_INSTANCE_REGISTRY_V1.every((item) => item.baseUrl.startsWith("https://"))).toBe(true);
    expect(hasSelectableDiscourseInstanceSupply()).toBe(true);
  });
});
