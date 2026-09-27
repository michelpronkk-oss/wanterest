import { describe, expect, it } from "vitest";

import { businessClassificationFixtures } from "../../src/server/modules/intelligence/business-classification.fixtures";
import { classifyProductBusiness } from "../../src/server/modules/intelligence/business-classification.service";
import { demandProfileV2Fixtures } from "../../src/server/modules/intelligence/demand-profile-v2.fixtures";
import { buildDemandProfileV2, readDemandProfileV2RoutingModel } from "../../src/server/modules/intelligence/demand-profile-v2.service";
import { buildQueryPlan, buildQueryPlanV8, buildSourceRoutingPlan, type QueryPlan, type QueryPlanQuery, type SourceRoutingSourceState } from "../../src/server/modules/operations";

const sources = (): SourceRoutingSourceState[] => ["hacker-news", "bluesky", "reddit", "github", "x", "stack-exchange", "g2"].map((sourceKey) => ({ sourceKey, configured: true, controlState: "enabled", healthStatus: "healthy" }));

async function planFor(index: number, productName?: string): Promise<{ v7: QueryPlan; v8: QueryPlan }> {
  const fixture = demandProfileV2Fixtures[index]!;
  const classificationNames: Record<number, string> = { 0: "B2B CRM SaaS", 1: "developer tool", 2: "consumer app", 4: "ecommerce shoes", 8: "local dentist", 12: "B2B CRM SaaS", 13: "ambiguous" };
  const classificationFixture = businessClassificationFixtures.find((candidate) => candidate.name === (classificationNames[index] ?? "B2B CRM SaaS"));
  if (!classificationFixture) throw new Error("Missing classification fixture");
  const classification = await classifyProductBusiness({ ...classificationFixture.input, productName: productName ?? fixture.input.productName, snapshotText: fixture.input.snapshotText });
  const profile = await buildDemandProfileV2({ ...fixture.input, productName: productName ?? fixture.input.productName, businessClassification: classification, snapshot: { id: "77777777-7777-4777-8777-777777777777", normalized_text: fixture.input.snapshotText, source_url: fixture.input.websiteUrl ?? null, metadata: {}, page_type: "manual" } });
  const model = readDemandProfileV2RoutingModel(profile);
  const routing = buildSourceRoutingPlan({ productId: `v8-${index}`, classification, demandProfile: model, sourceStates: sources(), scanMode: "onboarding", totalCandidateBudget: 40, maxSources: 6 });
  const input = { classification, demandProfile: model, sourceRoutingPlan: routing, scanMode: "onboarding" as const, maxQueries: 15 };
  return { v7: buildQueryPlan(input), v8: buildQueryPlanV8(input) };
}

function queries(plan: QueryPlan): QueryPlanQuery[] {
  return plan.source_plans.flatMap((source) => source.queries);
}

function competitor(query: QueryPlanQuery): boolean {
  return query.competitor_specific || ["switching", "alternative_search", "competitor_pain"].includes(query.demand_surface);
}

describe("Query Planning v8 quality layer", () => {
  it("keeps the v7 baseline available and produces a deterministic v8 plan", async () => {
    const first = await planFor(0, "Linear");
    const second = await planFor(0, "Linear");
    expect(first.v7.version).toBe("query_planning_v7");
    expect(first.v8.version).toBe("query_planning_v8");
    expect(first.v8).toEqual(second.v8);
    expect(first.v7).toEqual(second.v7);
    expect(queries(first.v8).every((query) => query.metadata.planner_version === "query_planning_v8")).toBe(true);
    expect(queries(first.v8).every((query) => !/^(struggling with|problem with|issues with|issue with)\b/i.test(query.query_text))).toBe(true);
  });

  it("canonicalizes pain language and keeps Hacker News queries concise", async () => {
    const { v7, v8 } = await planFor(1, "Linear");
    const v7Pain = queries(v7).filter((query) => query.query_family === "pain");
    const v8Pain = queries(v8).filter((query) => query.query_family === "pain");
    expect(v8Pain.length).toBeLessThanOrEqual(v7Pain.length);
    expect(v8Pain.every((query) => query.query_text.toLowerCase().includes(" with ") || query.source_key === "hacker-news")).toBe(true);
    for (const query of queries(v8).filter((item) => item.source_key === "hacker-news")) expect(query.query_text.length).toBeLessThanOrEqual(100);
  });

  it("enforces deterministic minority competitor allocation", async () => {
    const { v8 } = await planFor(0, "Linear");
    const all = queries(v8);
    const competitorCount = all.filter(competitor).length;
    const nonCompetitorCount = all.length - competitorCount;
    expect(competitorCount).toBeLessThanOrEqual(Math.max(1, Math.floor((nonCompetitorCount * 0.35) / 0.65)));
    expect(all.some((query) => !competitor(query))).toBe(true);
  });

  it.each([0, 1, 2, 4, 8, 12, 13])("keeps generic planning invariants for regression profile %i", async (index) => {
    const { v8 } = await planFor(index);
    const all = queries(v8);
    expect(v8.version).toBe("query_planning_v8");
    expect(all.length).toBeLessThanOrEqual(15);
    expect(new Set(all.map((query) => `${query.source_key}:${query.normalized_query}`)).size).toBe(all.length);
    expect(all.every((query) => query.normalized_query === query.normalized_query.toLowerCase())).toBe(true);
    expect(all.every((query) => query.query_text.length > 0 && query.query_text.length <= 180)).toBe(true);
    expect(all.every((query) => !/\b(issues with|problem with|struggling with)\s+.*\s+\1\b/i.test(query.query_text))).toBe(true);
  });

  it("deduplicates trivial variants in v8 planner seed candidates without changing v7", async () => {
    const { v7, v8 } = await planFor(0, "Linear");
    expect(v8.diagnostics.suppressed_duplicate_count).toBeGreaterThanOrEqual(v7.diagnostics.suppressed_duplicate_count);
    expect(v8.source_plans.every((source) => source.query_budget === source.queries.length)).toBe(true);
  });
});
