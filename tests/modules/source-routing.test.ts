import { describe, expect, it } from "vitest";

import { businessClassificationFixtures } from "../../src/server/modules/intelligence/business-classification.fixtures";
import { classifyProductBusiness } from "../../src/server/modules/intelligence/business-classification.service";
import { buildDemandProfileV2, readDemandProfileV2RoutingModel } from "../../src/server/modules/intelligence/demand-profile-v2.service";
import { demandProfileV2Fixtures } from "../../src/server/modules/intelligence/demand-profile-v2.fixtures";
import {
  buildSourceRoutingPlan,
  formatSourceRoutingDryRun,
  selectExecutableSourceRoutes,
  sourceRoutingCapabilityProfiles,
  type SourceRoutingSourceState,
} from "../../src/server/modules/operations/source-routing.index";

const allHealthy = (): SourceRoutingSourceState[] => [
  { sourceKey: "hacker-news", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "bluesky", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "reddit", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "github", configured: true, controlState: "enabled", healthStatus: "healthy" },
  { sourceKey: "x", configured: true, controlState: "enabled", healthStatus: "healthy" },
];

const fixturePairs = [
  ["B2B CRM SaaS", "B2B CRM SaaS"],
  ["developer tool", "developer tool"],
  ["consumer app", "consumer app"],
  ["ecommerce shoes", "ecommerce running-shoe brand"],
  ["marketplace", "marketplace"],
  ["agency", "agency"],
  ["professional service", "generic service business"],
  ["local dentist", "local dentist"],
  ["local restaurant", "local dentist"],
  ["global SaaS with office", "global SaaS with local HQ"],
  ["ambiguous", "ambiguous minimal landing page"],
  ["mixed software and consumer", "mixed business model"],
  ["B2B CRM SaaS", "B2B CRM SaaS"],
  ["developer tool", "developer tool"],
  ["ecommerce shoes", "ecommerce running-shoe brand"],
  ["ambiguous", "ambiguous minimal landing page"],
] as const;

async function buildPlan(index: number, sourceStates = allHealthy()) {
  const [classificationName, profileName] = fixturePairs[index];
  const classificationFixture = businessClassificationFixtures.find((fixture) => fixture.name === classificationName);
  const profileFixture = demandProfileV2Fixtures.find((fixture) => fixture.name === profileName);
  if (!classificationFixture || !profileFixture) throw new Error(`Missing source-routing fixture ${classificationName}/${profileName}`);
  const classification = await classifyProductBusiness(classificationFixture.input);
  const profile = await buildDemandProfileV2({
    ...profileFixture.input,
    snapshot: { id: "33333333-3333-4333-8333-333333333333", normalized_text: profileFixture.input.snapshotText, source_url: profileFixture.input.websiteUrl ?? null, metadata: {}, page_type: "manual" },
    businessClassification: classification,
  });
  return buildSourceRoutingPlan({
    productId: `product-${index}`,
    classification,
    demandProfile: readDemandProfileV2RoutingModel(profile),
    sourceStates,
    scanMode: "onboarding",
    totalCandidateBudget: 15,
    maxSources: 3,
  });
}

describe("Source Routing v1", () => {
  it("exposes centralized provider-neutral capabilities for every initial source", () => {
    expect(Object.keys(sourceRoutingCapabilityProfiles).sort()).toEqual(["bluesky", "github", "hacker-news", "reddit", "x", "fixture"].sort());
    for (const profile of Object.values(sourceRoutingCapabilityProfiles)) {
      expect(profile.cost_class).toBeTruthy();
      expect(profile.supports_problem_discussion).toBeGreaterThanOrEqual(0);
      expect(profile.supports_problem_discussion).toBeLessThanOrEqual(1);
      expect(profile.supports_recency).toBeGreaterThanOrEqual(0);
      expect(profile.supports_recency).toBeLessThanOrEqual(1);
    }
  });

  it.each(fixturePairs.map((_, index) => index))("builds a deterministic bounded route plan for fixture %i", async (index) => {
    const first = await buildPlan(index);
    const second = await buildPlan(index);
    expect(second).toEqual(first);
    expect(first.version).toBe("source_routing_v1");
    expect(first.routes.filter((route) => route.max_candidates > 0).length).toBeLessThanOrEqual(3);
    expect(first.routes.filter((route) => route.max_candidates > 0).every((route) => route.max_candidates > 0)).toBe(true);
    expect(first.diagnostics.executable_budget).toBeLessThanOrEqual(15);
    const budgetWeight = first.routes.reduce((sum, route) => sum + route.budget_weight, 0);
    expect(budgetWeight).toBe(first.diagnostics.selected_sources.length ? 1 : 0);
    expect(first.routes.every((route) => route.relevance_score >= 0 && route.relevance_score <= 1)).toBe(true);
  });

  it("strongly prioritizes developer sources for a developer tool", async () => {
    const plan = await buildPlan(1);
    const github = plan.routes.find((route) => route.source_key === "github");
    const hackerNews = plan.routes.find((route) => route.source_key === "hacker-news");
    expect(github?.priority).toBe("very_high");
    expect(hackerNews?.priority).toBe("very_high");
    expect(plan.diagnostics.selected_sources).toContain("github");
  });

  it("allows a relevant Bluesky route as the fourth manual source", async () => {
    const states = allHealthy().map((state) => state.sourceKey === "reddit" ? { ...state, configured: false, reason: "approval_pending" } : state);
    const classificationFixture = businessClassificationFixtures.find((fixture) => fixture.name === "B2B CRM SaaS");
    const profileFixture = demandProfileV2Fixtures.find((fixture) => fixture.name === "B2B CRM SaaS");
    if (!classificationFixture || !profileFixture) throw new Error("Missing manual routing fixture.");
    const classification = await classifyProductBusiness(classificationFixture.input);
    const profile = await buildDemandProfileV2({
      ...profileFixture.input,
      snapshot: { id: "66666666-6666-4666-8666-666666666666", normalized_text: profileFixture.input.snapshotText, source_url: profileFixture.input.websiteUrl ?? null, metadata: {}, page_type: "manual" },
      businessClassification: classification,
    });
    const plan = buildSourceRoutingPlan({
      productId: "manual-depth-routing",
      classification,
      demandProfile: readDemandProfileV2RoutingModel(profile),
      sourceStates: states,
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
    expect(plan.diagnostics.selected_sources).toHaveLength(4);
    expect(plan.diagnostics.selected_sources).toContain("bluesky");
    expect(plan.routes.find((route) => route.source_key === "x")?.max_candidates ?? 0).toBeLessThanOrEqual(8);
    expect(plan.routes.find((route) => route.source_key === "github")?.max_candidates ?? 0).toBeLessThanOrEqual(10);
    expect(plan.routes.find((route) => route.source_key === "hacker-news")?.max_candidates ?? 0).toBeLessThanOrEqual(6);
    expect(plan.routes.find((route) => route.source_key === "bluesky")?.max_candidates ?? 0).toBeLessThanOrEqual(8);
  });

  it("keeps ecommerce and local routing away from technically irrelevant sources", async () => {
    const ecommerce = await buildPlan(3);
    expect(ecommerce.routes.find((route) => route.source_key === "hacker-news")?.priority).toBe("off");
    expect(ecommerce.routes.find((route) => route.source_key === "github")?.priority).toBe("off");

    const local = await buildPlan(7);
    expect(local.routes.find((route) => route.source_key === "hacker-news")?.priority).toBe("off");
    expect(local.routes.find((route) => route.source_key === "github")?.priority).toBe("off");
    expect(local.coverage_status).toMatch(/limited|weak|unsupported/);
    expect(local.diagnostics.missing_source_capabilities).toContain("local_reviews");
  });

  it("separates relevance from availability and does not select unavailable Reddit", async () => {
    const states = allHealthy().map((state) => state.sourceKey === "reddit" ? { ...state, configured: false, reason: "approval_pending" } : state);
    const plan = await buildPlan(12, states);
    const reddit = plan.routes.find((route) => route.source_key === "reddit");
    expect(reddit?.enabled_for_product).toBe(true);
    expect(reddit?.availability_status).toBe("not_configured");
    expect(reddit?.max_candidates).toBe(0);
    expect(plan.diagnostics.operational_exclusions.some((source) => source.source_key === "reddit")).toBe(true);
    expect(plan.diagnostics.selected_sources).not.toContain("reddit");
  });

  it("treats paused GitHub and unavailable paid X conservatively", async () => {
    const paused = allHealthy().map((state) => state.sourceKey === "github" ? { ...state, controlState: "paused" } : state);
    const developer = await buildPlan(13, paused);
    expect(developer.routes.find((route) => route.source_key === "github")?.availability_status).toBe("paused");
    expect(developer.diagnostics.selected_sources).not.toContain("github");

    const xUnavailable = allHealthy().map((state) => state.sourceKey === "x" ? { ...state, configured: false } : state);
    const ecommerce = await buildPlan(14, xUnavailable);
    expect(ecommerce.routes.find((route) => route.source_key === "x")?.availability_status).toBe("not_configured");
    expect(ecommerce.routes.find((route) => route.source_key === "x")?.max_candidates).toBe(0);
    expect(ecommerce.diagnostics.selected_sources).not.toContain("x");
  });

  it("falls back to conservative classification-only planning with no profile", async () => {
    const classificationFixture = businessClassificationFixtures.find((fixture) => fixture.name === "B2B CRM SaaS");
    if (!classificationFixture) throw new Error("Missing classification fixture.");
    const classification = await classifyProductBusiness(classificationFixture.input);
    const plan = buildSourceRoutingPlan({ productId: "fallback", classification, demandProfile: null, sourceStates: allHealthy(), scanMode: "onboarding", totalCandidateBudget: 15, maxSources: 3 });
    expect(plan.demand_profile_version).toBeNull();
    expect(selectExecutableSourceRoutes(plan).length).toBeGreaterThan(0);
    expect(plan.routes.find((route) => route.source_key === "hacker-news")?.reason_codes).toContain("PROFILE_CONFIDENCE_LOW");
  });

  it("provides a network-free dry-run representation", async () => {
    const plan = await buildPlan(0);
    const output = formatSourceRoutingDryRun(plan);
    expect(output).toContain("source_routing_v1");
    expect(output).toContain("hacker-news:");
    expect(output).not.toContain("Authorization");
  });
});
