import { describe, expect, it } from "vitest";

import { businessClassificationFixtures } from "../../src/server/modules/intelligence/business-classification.fixtures";
import { classifyProductBusiness } from "../../src/server/modules/intelligence/business-classification.service";
import { demandProfileV2Fixtures } from "../../src/server/modules/intelligence/demand-profile-v2.fixtures";
import { buildDemandProfileV2, readDemandProfileV2RoutingModel } from "../../src/server/modules/intelligence/demand-profile-v2.service";
import {
  buildQueryPlan,
  buildSourceRoutingPlan,
  formatQueryPlanDryRun,
  toSourceDiscoveryRequest,
  type QueryPlan,
  type QueryPlanQuery,
  type QueryPlanSource,
  type SourceRoutingSourceState,
} from "../../src/server/modules/operations";

const healthySources = (): SourceRoutingSourceState[] => [
  { sourceKey: "hacker-news", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "bluesky", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "reddit", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "github", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "x", configured: true, controlState: "enabled", healthStatus: "healthy" },
];

const cases = [
  ["B2B CRM SaaS", "explicit competitor page"],
  ["developer tool", "developer tool"],
  ["developer tool", "developer tool"],
  ["consumer app", "consumer app"],
  ["ecommerce shoes", "ecommerce running-shoe brand"],
  ["marketplace", "marketplace"],
  ["agency", "agency"],
  ["professional service", "generic service business"],
  ["local dentist", "local dentist"],
  ["global SaaS with office", "global SaaS with local HQ"],
  ["B2B CRM SaaS", "B2B CRM SaaS"],
  ["B2B CRM SaaS", "explicit competitor page"],
  ["B2B CRM SaaS", "manual process alternative"],
  ["ambiguous", "ambiguous minimal landing page"],
  ["B2B CRM SaaS", "alternative to page"],
  ["developer tool", "developer tool"],
] as const;

async function buildFixturePlan(index: number, sourceStates = healthySources(), maxQueries?: number): Promise<QueryPlan> {
  const [classificationName, profileName] = cases[index];
  const classificationFixture = businessClassificationFixtures.find((fixture) => fixture.name === classificationName);
  const profileFixture = demandProfileV2Fixtures.find((fixture) => fixture.name === profileName);
  if (!classificationFixture || !profileFixture) throw new Error(`Missing query-planning fixture ${classificationName}/${profileName}`);
  const classification = await classifyProductBusiness(classificationFixture.input);
  const profile = await buildDemandProfileV2({
    ...profileFixture.input,
    snapshot: { id: "44444444-4444-4444-8444-444444444444", normalized_text: profileFixture.input.snapshotText, source_url: profileFixture.input.websiteUrl ?? null, metadata: {}, page_type: "manual" },
    businessClassification: classification,
  });
  const routing = buildSourceRoutingPlan({
    productId: `query-product-${index}`,
    classification,
    demandProfile: readDemandProfileV2RoutingModel(profile),
    sourceStates,
    scanMode: "onboarding",
    totalCandidateBudget: 15,
    maxSources: 3,
  });
  return buildQueryPlan({ classification, demandProfile: readDemandProfileV2RoutingModel(profile), sourceRoutingPlan: routing, scanMode: "onboarding", maxQueries });
}

async function buildManualFixturePlan(index: number, sourceStates = healthySources()): Promise<QueryPlan> {
  const [classificationName, profileName] = cases[index];
  const classificationFixture = businessClassificationFixtures.find((fixture) => fixture.name === classificationName);
  const profileFixture = demandProfileV2Fixtures.find((fixture) => fixture.name === profileName);
  if (!classificationFixture || !profileFixture) throw new Error(`Missing query-planning fixture ${classificationName}/${profileName}`);
  const classification = await classifyProductBusiness(classificationFixture.input);
  const profile = await buildDemandProfileV2({
    ...profileFixture.input,
    snapshot: { id: "55555555-5555-4555-8555-555555555555", normalized_text: profileFixture.input.snapshotText, source_url: profileFixture.input.websiteUrl ?? null, metadata: {}, page_type: "manual" },
    businessClassification: classification,
  });
  const routing = buildSourceRoutingPlan({
    productId: `manual-query-product-${index}`,
    classification,
    demandProfile: readDemandProfileV2RoutingModel(profile),
    sourceStates,
    scanMode: "manual",
    totalCandidateBudget: 30,
    maxSources: 4,
    safetyCaps: {
      x: { maxCandidates: 8, maxPages: 1 },
      github: { maxCandidates: 10, maxPages: 3 },
      "hacker-news": { maxCandidates: 6, maxPages: 3 },
      bluesky: { maxCandidates: 8, maxPages: 1 },
    },
  });
  return buildQueryPlan({ classification, demandProfile: readDemandProfileV2RoutingModel(profile), sourceRoutingPlan: routing, scanMode: "manual" });
}

function allQueries(plan: QueryPlan) {
  return plan.source_plans.flatMap((source) => source.queries);
}

describe("Query Planning v1", () => {
  it.each(cases.map((_, index) => index))("builds a bounded deterministic plan for fixture %i", async (index) => {
    const first = await buildFixturePlan(index);
    const second = await buildFixturePlan(index);
    expect(second).toEqual(first);
    expect(first.version).toBe("query_planning_v4");
    expect(first.source_routing_version).toBe("source_routing_v1");
    expect(first.source_plans.every((source) => source.query_budget <= 3)).toBe(true);
    expect(allQueries(first).every((query) => query.candidate_budget > 0)).toBe(true);
    expect(allQueries(first).every((query) => query.normalized_query === query.normalized_query.toLowerCase())).toBe(true);
  });

  it("prioritizes commercial SaaS demand and keeps X bounded", async () => {
    const plan = await buildFixturePlan(0);
    const queries = allQueries(plan);
    expect(queries.some((query) => query.query_family === "alternative_search" && query.competitor_refs.length > 0)).toBe(true);
    expect(queries.some((query) => query.query_family === "switching")).toBe(true);
    expect(new Set(queries.map((query) => query.demand_surface)).size).toBeGreaterThan(1);
    const x = plan.source_plans.find((source) => source.source_key === "x");
    if (x) {
      expect(x.query_budget).toBeLessThanOrEqual(3);
      expect(x.queries.reduce((sum, query) => sum + query.candidate_budget, 0)).toBeLessThanOrEqual(10);
    }
  });

  it("preserves demand-surface diversity through the four-query global cap", async () => {
    const plan = await buildFixturePlan(0, healthySources(), 4);
    const queries = allQueries(plan);
    const competitorSurfaces = new Set(["switching", "alternative_search", "competitor_pain"]);
    const competitorSpecific = queries.filter((query) => competitorSurfaces.has(query.demand_surface));
    const nonCompetitorAvailable = queries.some((query) => !competitorSurfaces.has(query.demand_surface));

    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(new Set(queries.map((query) => query.demand_surface)).size).toBeGreaterThan(1);
    expect(nonCompetitorAvailable).toBe(true);
    expect(competitorSpecific.length).toBeLessThanOrEqual(2);
    expect(Object.keys(plan.diagnostics.demand_surface_coverage).sort()).toEqual([...new Set(queries.map((query) => query.demand_surface))].sort());
  });

  it("anchors job and pain demand in category context and marks known competitors", async () => {
    const plan = await buildFixturePlan(0, healthySources(), 4);
    const queries = allQueries(plan);
    for (const query of queries.filter((item) => item.query_family === "pain" || item.query_family === "jtbd")) {
      expect(query.concept_keys).toContain("category");
      expect(query.query_text).not.toMatch(/^need a way to /);
    }
    for (const query of queries.filter((item) => item.competitor_refs.length > 0)) expect(query.competitor_specific).toBe(true);
    expect(new Set(queries.map((query) => query.source_key)).size).toBeGreaterThan(1);
  });

  it("gives manual scans deeper, diverse source plans without changing onboarding caps", async () => {
    const plan = await buildManualFixturePlan(0, healthySources().filter((source) => source.sourceKey !== "reddit"));
    const totalQueries = allQueries(plan).length;
    expect(totalQueries).toBeGreaterThanOrEqual(10);
    expect(totalQueries).toBeLessThanOrEqual(12);
    for (const source of plan.source_plans) {
      const queryCap = source.source_key === "x" || source.source_key === "github" ? 4 : source.source_key === "hacker-news" ? 2 : 2;
      expect(source.query_budget).toBeLessThanOrEqual(queryCap);
      expect(source.queries.reduce((sum, query) => sum + query.candidate_budget, 0)).toBeLessThanOrEqual(source.candidate_budget);
    }
    expect(plan.source_plans.find((source) => source.source_key === "x")?.candidate_budget ?? 0).toBeLessThanOrEqual(8);
    expect(plan.source_plans.find((source) => source.source_key === "github")?.candidate_budget ?? 0).toBeLessThanOrEqual(10);
    expect(plan.source_plans.find((source) => source.source_key === "hacker-news")?.candidate_budget ?? 0).toBeLessThanOrEqual(6);
    expect(plan.source_plans.find((source) => source.source_key === "bluesky")?.candidate_budget ?? 0).toBeLessThanOrEqual(8);
  });

  it("gives HN broad semantic coverage and GitHub technical coverage", async () => {
    const plan = await buildFixturePlan(1);
    const hn = plan.source_plans.find((source) => source.source_key === "hacker-news");
    const github = plan.source_plans.find((source) => source.source_key === "github");
    const x = plan.source_plans.find((source) => source.source_key === "x");
    expect(hn?.query_budget ?? 0).toBeLessThanOrEqual(1);
    expect((hn?.queries[0]?.query_text.length ?? 0)).toBeGreaterThan(0);
    expect(github?.queries.some((query) => ["feature_requirement", "pain", "jtbd", "switching"].includes(query.query_family))).toBe(true);
    expect(github?.queries.every((query) => !["recommendation", "category_discovery"].includes(query.query_family))).toBe(true);
    expect((hn?.query_budget ?? 0)).toBeLessThanOrEqual(x?.query_budget ?? 3);
  });

  it("keeps ecommerce and local planning away from GitHub/HN nonsense", async () => {
    const ecommerce = await buildFixturePlan(4);
    expect(ecommerce.source_plans.some((source) => source.source_key === "github" || source.source_key === "hacker-news")).toBe(false);
    expect(allQueries(ecommerce).some((query) => ["recommendation", "feature_requirement", "pain"].includes(query.query_family))).toBe(true);

    const local = await buildFixturePlan(8);
    expect(local.source_plans.some((source) => source.source_key === "github" || source.source_key === "hacker-news")).toBe(false);
    expect(allQueries(local).every((query) => query.geo_context !== null)).toBe(true);
    expect(local.overall_confidence).toBeLessThan(1);
  });

  it("handles known, detected, and non-brand alternatives without inventing competitors", async () => {
    const competitor = await buildFixturePlan(11);
    expect(allQueries(competitor).some((query) => query.competitor_refs.length > 0)).toBe(true);

    const partners = await buildFixturePlan(2);
    expect(allQueries(partners).every((query) => !query.query_text.toLowerCase().includes("slack") && !query.query_text.toLowerCase().includes("notion"))).toBe(true);

    const alternatives = await buildFixturePlan(12);
    const alternativeQueries = allQueries(alternatives).filter((query) => query.alternative_refs.length > 0);
    expect(alternativeQueries.length).toBeGreaterThan(0);
    expect(alternativeQueries.some((query) => query.query_text.toLowerCase().includes("build vs buy") || query.query_text.toLowerCase().includes("replace") || query.query_text.toLowerCase().includes("service provider"))).toBe(true);
  });

  it("is conservative for low confidence profiles", async () => {
    const plan = await buildFixturePlan(13);
    expect(plan.diagnostics.low_confidence).toBe(true);
    expect(plan.overall_confidence).toBeLessThan(0.6);
    expect(allQueries(plan).every((query) => query.competitor_refs.length === 0)).toBe(true);
    expect(plan.source_plans.every((source) => source.query_budget <= 2)).toBe(true);
  });

  it("deduplicates near-identical templates while preserving family diversity", async () => {
    const plan = await buildFixturePlan(15);
    const queries = allQueries(plan);
    expect(plan.diagnostics.suppressed_duplicate_count).toBeGreaterThan(0);
    expect(new Set(queries.map((query) => query.query_family)).size).toBeGreaterThan(1);
    expect(new Set(queries.map((query) => `${query.source_key}:${query.normalized_query}`)).size).toBe(queries.length);
  });

  it("respects source candidate budgets and keeps query budgets positive", async () => {
    const plan = await buildFixturePlan(0);
    for (const source of plan.source_plans) {
      expect(source.queries.reduce((sum, query) => sum + query.candidate_budget, 0)).toBeLessThanOrEqual(source.candidate_budget);
      expect(source.queries.every((query) => query.candidate_budget > 0)).toBe(true);
    }
  });

  it("keeps semantic planning separate from provider syntax", async () => {
    const plan = await buildFixturePlan(0);
    const xQuery = plan.source_plans.find((source) => source.source_key === "x")?.queries[0];
    if (xQuery) {
      const request = toSourceDiscoveryRequest({ sourcePlan: plan.source_plans.find((source) => source.source_key === "x")!, query: xQuery, maxPages: 1 });
      expect(request.query).not.toContain("-is:retweet");
      expect(request.query).not.toMatch(/productivity_software|problem_solution_search|because/);
      expect(request.requestMetadata.excludeRetweets).toBe(true);
      expect(request.requestMetadata.maxResults).toBe(xQuery.candidate_budget);
      expect(request.requestMetadata.maxBillablePostsPerDiscovery).toBeGreaterThanOrEqual(10);
      expect(request.requestMetadata).toMatchObject({
        demandSurface: xQuery.demand_surface,
        competitorSpecific: xQuery.competitor_specific,
        discoveryIntent: xQuery.metadata.discovery_intent,
      });
    }
    const hn = plan.source_plans.find((source) => source.source_key === "hacker-news");
    if (hn?.queries[0]) {
      const request = toSourceDiscoveryRequest({ sourcePlan: hn, query: hn.queries[0], maxPages: 1 });
      expect(request.query).toBe(hn.queries[0].query_text);
      expect(request.requestMetadata.semanticQuery).toBe(hn.queries[0].query_text);
      expect(request.requestMetadata.executionMode).toBe("filtered_newstories_feed");
    }
  });

  it("adds bounded provider-native budgets for YouTube and GitLab", () => {
    const query: QueryPlanQuery = {
      query_id: "qp-test",
      query_family: "comparison",
      demand_surface: "competitor_pain",
      competitor_specific: false,
      intent_type: "comparison_intent",
      query_text: "Jira alternative",
      normalized_query: "jira alternative",
      source_key: "youtube",
      priority: "high",
      confidence: 0.9,
      candidate_budget: 8,
      reason_codes: ["COMPARISON_INTENT"],
      reason_summary: "Generated from comparison intent.",
      concept_keys: ["competitor"],
      competitor_refs: [],
      alternative_refs: [],
      geo_context: null,
      language_context: null,
      cost_hint: "paid_medium",
      metadata: { provider_context: {} },
    };
    const youtube = toSourceDiscoveryRequest({ sourcePlan: { source_key: "youtube" } as QueryPlanSource, query, maxPages: 2 });
    const gitlab = toSourceDiscoveryRequest({ sourcePlan: { source_key: "gitlab" } as QueryPlanSource, query: { ...query, source_key: "gitlab", query_family: "feature_requirement" }, maxPages: 2 });
    expect(youtube.requestMetadata).toMatchObject({ maxVideos: 5, maxCommentsPerVideo: 3, includeReplies: false, maxPages: 2, providerQuery: "Jira alternative" });
    expect(gitlab.requestMetadata).toMatchObject({ maxProjects: 2, maxIssuesPerProject: 5, maxNotesPerIssue: 4, includeDiscussions: true, maxPages: 2, providerQuery: "Jira alternative" });
  });

  it("provides a network-free dry-run", async () => {
    const plan = await buildFixturePlan(0);
    const output = formatQueryPlanDryRun(plan);
    expect(output).toContain("query_planning_v4");
    expect(output).toContain("candidateBudget=");
    expect(output).toContain("reasons=");
    expect(allQueries(plan).every((query) => query.reason_summary.startsWith("Generated from "))).toBe(true);
  });
});
