import { describe, expect, it } from "vitest";

import type { ProductRow } from "../../src/server/db/database.helpers";
import {
  BUSINESS_CLASSIFICATION_VERSION,
  FixtureBusinessClassificationEngine,
  FixtureDemandProfileV2Engine,
  InMemoryIntelligenceRepository,
  IntelligenceService,
  StructuredLlmDemandProfileV2Engine,
  buildDemandProfileV2,
  classifyProductBusiness,
  demandProfileV2Fixtures,
  demandProfileV2Version,
  projectDemandProfileV2ForQualification,
  readDemandProfileV2RoutingModel,
  tryBuildDemandProfileV2,
} from "../../src/server/modules/intelligence";
import { normalizeDemandProfileV2 } from "../../src/server/modules/intelligence/demand-profile-v2.normalizer";

const snapshot = (text: string, sourceReference = "fixture:snapshot") => ({
  id: "33333333-3333-4333-8333-333333333333",
  normalized_text: text,
  source_url: "https://example.test",
  metadata: { source_reference: sourceReference },
  page_type: "manual",
} as const);

const product: ProductRow = {
  id: "22222222-2222-4222-8222-222222222222",
  workspace_id: "11111111-1111-4111-8111-111111111111",
  name: "Demand Profile Fixture",
  slug: "demand-profile-fixture",
  website_url: "https://example.test",
  status: "active",
  current_snapshot_id: null,
  current_demand_profile_id: null,
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
};

async function buildFixture(name: string) {
  const fixture = demandProfileV2Fixtures.find((item) => item.name === name);
  if (!fixture) throw new Error(`Missing fixture: ${name}`);
  const classification = await classifyProductBusiness({ ...fixture.input });
  return buildDemandProfileV2({
    ...fixture.input,
    snapshot: snapshot(fixture.input.snapshotText, fixture.input.sourceReference),
    businessClassification: classification,
  });
}

describe("Demand Profile v2", () => {
  it.each(demandProfileV2Fixtures)("builds a bounded evidence-backed profile for $name", async (fixture) => {
    const classification = await classifyProductBusiness({ ...fixture.input });
    const profile = await buildDemandProfileV2({
      ...fixture.input,
      snapshot: snapshot(fixture.input.snapshotText, fixture.input.sourceReference),
      businessClassification: classification,
    });
    expect(profile.version).toBe(demandProfileV2Version);
    expect(profile.identity.business_type).toBe(classification.business_type);
    expect(profile.identity.business_model).toBe(classification.business_model);
    expect(profile.identity.technical_orientation).toBe(classification.technical_orientation);
    expect(profile.confidence.overall_profile_confidence).toBeGreaterThanOrEqual(0);
    expect(profile.confidence.overall_profile_confidence).toBeLessThanOrEqual(1);
    expect(profile.evidence.length).toBeGreaterThan(0);
    expect(profile.problems.length).toBeLessThanOrEqual(12);
    expect(profile.jobs_to_be_done.length).toBeLessThanOrEqual(10);
    expect(profile.feature_demands.length).toBeLessThanOrEqual(15);
    expect(profile.alternatives.length).toBeLessThanOrEqual(10);
    if (fixture.expectations.minimumPainCount !== undefined) expect(profile.problems.length).toBeGreaterThanOrEqual(fixture.expectations.minimumPainCount);
    if (fixture.expectations.minimumOutcomeCount !== undefined) expect(profile.desired_outcomes.length).toBeGreaterThanOrEqual(fixture.expectations.minimumOutcomeCount);
    if (fixture.expectations.minimumJobCount !== undefined) expect(profile.jobs_to_be_done.length).toBeGreaterThanOrEqual(fixture.expectations.minimumJobCount);
    if (fixture.expectations.minimumAlternativeCount !== undefined) expect(profile.alternatives.length).toBeGreaterThanOrEqual(fixture.expectations.minimumAlternativeCount);
    if (fixture.expectations.requiresCompetitor) expect(profile.competitors.known_competitors.some((item) => item.name === fixture.expectations.requiresCompetitor)).toBe(true);
    if (fixture.expectations.forbidsCompetitors) expect(profile.competitors.known_competitors).toHaveLength(0);
  });

  it("separates pains from outcomes and preserves structured JTBD, switching, feature, objection, and language data", async () => {
    const profile = await buildFixture("B2B CRM SaaS");
    expect(profile.problems.some((item) => item.label === "fragmented workflow")).toBe(true);
    expect(profile.desired_outcomes.some((item) => item.label === "reduce onboarding time")).toBe(true);
    expect(profile.problems.map((item) => item.label)).not.toContain("reduce onboarding time");
    expect(profile.jobs_to_be_done[0]).toMatchObject({ actor: "sales team", context: "small team" });
    expect(profile.feature_demands[0]).toHaveProperty("importance_hint");
    expect(profile.language.category_terms).toContain("crm");
    expect(profile.evidence.every((item) => item.source_reference.startsWith("fixture:"))).toBe(true);
  });

  it("keeps competitor and alternative concepts distinct", async () => {
    const competitor = await buildFixture("explicit competitor page");
    expect(competitor.competitors.known_competitors[0]).toMatchObject({ name: "Salesforce", relationship_type: "direct_competitor", domain: null });
    expect(competitor.alternatives).toHaveLength(0);

    const alternatives = await buildFixture("manual process alternative");
    expect(alternatives.alternatives.map((item) => item.alternative_type)).toEqual(expect.arrayContaining(["manual_process", "internal_build", "service_provider", "status_quo"]));
    expect(alternatives.competitors.known_competitors).toHaveLength(0);
  });

  it("does not promote integration partners or customer logos to competitors", async () => {
    const profile = await buildFixture("integration partners and customer logos");
    expect(profile.competitors.known_competitors).toHaveLength(0);
    expect(profile.competitors.detected_competitor_candidates).toHaveLength(0);
    expect(profile.feature_demands.some((item) => item.feature === "API access")).toBe(true);
  });

  it("inherits local geography and preserves global SaaS location independence", async () => {
    const local = await buildFixture("local dentist");
    expect(local.geography.market_scope).toBe("local");
    expect(local.geography.primary_city).toBeNull();
    expect(local.geography.location_dependency).toBeGreaterThan(0.9);
    expect(local.geography.demand_geography_terms).toContain("near me");

    const global = await buildFixture("global SaaS with local HQ");
    expect(global.geography.market_scope).toBe("global");
    expect(global.geography.primary_country_code).toBe("NL");
    expect(global.geography.primary_city).toBe("Amsterdam");
    expect(global.geography.location_dependency).toBeLessThan(0.2);
  });

  it("normalizes invalid values, duplicate concepts, unsupported domains, and confidence safely", () => {
    const result = normalizeDemandProfileV2({
      identity: { product_name: "Product", primary_category: "CRM", business_type: "not-real", business_model: "not-real", delivery_model: "not-real", technical_orientation: "not-real", market_scope: "not-real", secondary_categories: ["CRM", "crm"] },
      audience: { target_customer_types: ["Teams", "teams"], buyer_roles: [], end_user_types: [], company_size_segments: [], industry_segments: [] },
      problems: [{ key: "manual_entry", label: "Manual entry", description: "Manual entry", severity_hint: 4, specificity: -1, confidence: 2, evidence: [{ source_type: "website_text", source_reference: "fixture:normalizer", field_path: "problems.manual_entry", excerpt: null, reason: "Observed", confidence: 3 }] }, { key: "manual_entry", label: "Duplicate", description: "Duplicate", severity_hint: null, specificity: 0.2, confidence: 0.2, evidence: [] }],
      evidence: [{ source_type: "website_text", source_reference: "fixture:normalizer", field_path: "problems.manual_entry", excerpt: "manual entry", reason: "Observed", confidence: 2 }],
      competitors: { known_competitors: [{ name: "Unknown", domain: "not a domain", relationship_type: "bad", reason: "weak", confidence: 4, evidence: [] }], detected_competitor_candidates: [] },
      alternatives: [], desired_outcomes: [], jobs_to_be_done: [], switching_triggers: [], buying_intents: [], feature_demands: [], objections: [], comparison_terms: [], language: {}, geography: {}, confidence: {},
    }, { productName: "Product", version: demandProfileV2Version });
    expect(result.identity.business_type).toBe("other");
    expect(result.identity.business_model).toBe("unknown");
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].severity_hint).toBe(1);
    expect(result.problems[0].specificity).toBe(0);
    expect(result.competitors.known_competitors[0].domain).toBeNull();
    expect(result.confidence.overall_profile_confidence).toBe(0);
  });

  it("exposes compact routing and qualification projections without changing behavior", async () => {
    const profile = await buildFixture("developer tool");
    const routing = readDemandProfileV2RoutingModel(profile);
    const qualification = projectDemandProfileV2ForQualification(profile);
    expect(routing.technical_orientation).toBe("high");
    expect(routing.pains).toBe(profile.problems);
    expect(qualification.relevant_intents).toBe(profile.buying_intents);
    expect(qualification.geography).toBe(profile.geography);
  });

  it("uses the structured LLM port and protects the website-text boundary", async () => {
    let request: { schemaName: string; systemPrompt: string; userPrompt: string; jsonSchema?: Record<string, unknown>; maxOutputTokens?: number; temperature?: number } | undefined;
    const provider = {
      async generateStructured<T>(input: { schemaName: string; systemPrompt: string; userPrompt: string }) {
        request = input;
        return { value: { problems: [{ label: "manual workflow", description: "Manual work", confidence: 0.8, evidence: [{ source_type: "website_text", source_reference: "fixture:llm", field_path: "problems.manual_workflow", excerpt: "manual workflow", reason: "Observed", confidence: 0.8 }] }], evidence: [{ source_type: "website_text", source_reference: "fixture:llm", field_path: "problems.manual_workflow", excerpt: "manual workflow", reason: "Observed", confidence: 0.8 }] } as T, provider: "test", model: "test-model", promptVersion: "test-prompt" };
      },
    };
    const engine = new StructuredLlmDemandProfileV2Engine(provider);
    const profile = await buildDemandProfileV2({ productName: "LLM Fixture", snapshot: snapshot("Manual workflow is slow.", "fixture:llm"), sourceReference: "fixture:llm" }, engine);
    expect(profile.problems[0].label).toBe("manual workflow");
    expect(request?.schemaName).toBe("DemandProfileV2");
    expect(request?.jsonSchema).toMatchObject({ type: "object", properties: expect.any(Object) });
    expect(request?.maxOutputTokens).toBe(3_000);
    expect(request?.temperature).toBe(0);
    expect(request?.systemPrompt).toContain("untrusted data");
    expect(request?.userPrompt).toContain("Manual workflow is slow");
  });

  it("fails safely for unavailable or malformed LLM output and absent classification", async () => {
    const failingEngine = { engineType: "profile" as const, version: demandProfileV2Version, async generate() { throw new Error("provider unavailable"); } };
    expect(await tryBuildDemandProfileV2({ productName: "Product", snapshot: snapshot("Useful but sparse product text.") , sourceReference: "fixture:failure" }, failingEngine)).toBeNull();
    const malformedEngine = { engineType: "profile" as const, version: demandProfileV2Version, async generate() { return { output: { nonsense: true }, provider: "test", model: null, promptVersion: null }; } };
    expect(await tryBuildDemandProfileV2({ productName: "Product", snapshot: snapshot("Useful but sparse product text."), sourceReference: "fixture:malformed" }, malformedEngine)).toBeNull();
    const sparse = await tryBuildDemandProfileV2({ productName: "Nimbus", snapshot: snapshot("A new product.", "fixture:sparse"), sourceReference: "fixture:sparse" });
    expect(sparse?.confidence.overall_profile_confidence).toBeLessThanOrEqual(0.3);
    expect(sparse?.problems).toHaveLength(0);
  });

  it("persists v2 in immutable snapshot metadata and recomputes by engine version", async () => {
    const repository = new InMemoryIntelligenceRepository();
    repository.products.set(product.id, product);
    const service = new IntelligenceService(repository);
    const firstSnapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "B2B CRM software for teams." });
    const engine = new FixtureDemandProfileV2Engine();
    const first = await service.generateDemandProfileV2(product, "88888888-8888-4888-8888-888888888888", engine, firstSnapshot);
    const retry = await service.generateDemandProfileV2({ ...product, current_snapshot_id: first.snapshot.id }, "88888888-8888-4888-8888-888888888888", engine, first.snapshot);
    const changedEngine = { engineType: engine.engineType, version: demandProfileV2Version, generate: engine.generate.bind(engine) };
    const replay = await service.generateDemandProfileV2({ ...product, current_snapshot_id: first.snapshot.id }, "99999999-9999-4999-8999-999999999999", changedEngine, first.snapshot);
    const forced = await service.generateDemandProfileV2({ ...product, current_snapshot_id: replay.snapshot.id }, "99999999-9999-4999-8999-999999999999", changedEngine, replay.snapshot, undefined, true);
    expect(retry.snapshot.id).toBe(first.snapshot.id);
    expect(replay.snapshot.id).not.toBe(first.snapshot.id);
    expect(forced.snapshot.id).not.toBe(replay.snapshot.id);
    expect(repository.snapshots.size).toBe(4);
    expect(replay.profile.version).toBe(demandProfileV2Version);
    expect(replay.profile.engine_version_id).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("keeps Business Classification v1 as the identity authority", async () => {
    const fixture = demandProfileV2Fixtures.find((item) => item.name === "developer tool");
    if (!fixture) throw new Error("Fixture missing.");
    const classification = await classifyProductBusiness({ ...fixture.input }, new FixtureBusinessClassificationEngine());
    const profile = await buildDemandProfileV2({ ...fixture.input, snapshot: snapshot(fixture.input.snapshotText, fixture.input.sourceReference), businessClassification: classification });
    expect(classification.classification_version).toBe(BUSINESS_CLASSIFICATION_VERSION);
    expect(profile.identity.business_type).toBe(classification.business_type);
    expect(profile.identity.technical_orientation).toBe("high");
    expect(profile.geography.market_scope).toBe(classification.market_scope);
  });
});
