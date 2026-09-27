import { describe, expect, it } from "vitest";

import { toSourceDiscoveryRequest } from "../../src/server/modules/operations/query-planning.execution";
import type { QueryPlanQuery, QueryPlanSource } from "../../src/server/modules/operations/query-planning.schemas";

describe("DEV planner propagation", () => {
  it("preserves query_planning_v8 and applies bounded DEV depth metadata", () => {
    const query = {
      query_id: "devto-q1",
      query_family: "alternative_search",
      demand_surface: "alternative_search",
      competitor_specific: false,
      intent_type: "alternative_search",
      query_text: "project workflow alternative",
      normalized_query: "project workflow alternative",
      source_key: "devto",
      priority: "high",
      confidence: 0.8,
      candidate_budget: 6,
      reason_codes: [],
      reason_summary: "test",
      concept_keys: [],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "free_rate_limited",
      metadata: { planner_version: "query_planning_v8" },
    } satisfies QueryPlanQuery;
    const sourcePlan: QueryPlanSource = { source_key: "devto", priority: "high", candidate_budget: 6, query_budget: 1, queries: [query], excluded_query_families: [], reason_codes: [], confidence: 0.8 };
    const request = toSourceDiscoveryRequest({ sourcePlan, query, maxPages: 3 });
    expect(request).toMatchObject({ query: query.query_text, limit: 6, expandThreads: false, requestMetadata: { queryPlanVersion: "query_planning_v8", devToV1: true, depthPolicyVersion: "devto_depth_v1", maxPages: 2, maxArticlesToExpand: 4, maxCommentsPerArticle: 8, includeComments: true, topDays: 365 } });
  });
});
