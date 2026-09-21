import { describe, expect, it } from "vitest";

import { jsonValueSchema, type ProductRow } from "../../src/server/db/database.helpers";
import { sha256Text } from "../../src/server/modules/ingestion/hash";
import {
  BUSINESS_CLASSIFICATION_VERSION,
  FixtureBusinessClassificationEngine,
  InMemoryIntelligenceRepository,
  IntelligenceService,
  StructuredLlmBusinessClassificationEngine,
  businessClassificationFixtures,
  classifyProductBusiness,
  normalizeBusinessClassification,
  readBusinessClassificationModel,
  tryClassifyProductBusiness,
} from "../../src/server/modules/intelligence";

const product: ProductRow = {
  id: "22222222-2222-4222-8222-222222222222",
  workspace_id: "11111111-1111-4111-8111-111111111111",
  name: "Classification Fixture",
  slug: "classification-fixture",
  website_url: "https://example.test",
  status: "active",
  current_snapshot_id: null,
  current_demand_profile_id: null,
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
};

describe("Business Classification v1", () => {
  it.each(businessClassificationFixtures)("classifies $name with the controlled taxonomy", async (fixture) => {
    const result = await classifyProductBusiness(fixture.input);
    expect(result.business_type).toBe(fixture.expected.business_type);
    expect(result.business_model).toBe(fixture.expected.business_model);
    expect(result.market_scope).toBe(fixture.expected.market_scope);
    expect(result.primary_category).toBe(fixture.expected.primary_category);
    expect(result.classification_version).toBe(BUSINESS_CLASSIFICATION_VERSION);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.source_reference === fixture.input.sourceReference)).toBe(true);
  });

  it("normalizes invalid enums, country labels, confidence, and duplicate arrays", () => {
    const result = normalizeBusinessClassification({
      business_type: "not-a-type",
      business_model: "B2C",
      delivery_model: "not-a-delivery-model",
      market_scope: "not-a-scope",
      technical_orientation: "HIGH",
      commerce_type: "not-commerce",
      primary_category: "  CRM   ",
      secondary_categories: ["SaaS", "saas", "  CRM  "],
      target_customer_types: ["Teams", "teams"],
      buyer_roles: ["Founder"],
      end_user_types: ["Operator"],
      primary_country_code: "Netherlands",
      primary_region: "  North Holland ",
      primary_city: " Amsterdam ",
      location_dependency: -4,
      overall_confidence: 4,
      field_confidences: { business_type_confidence: 2 },
      evidence: [
        { field: "business_type", value: "other", reason: "weak evidence", source_type: "website_text", source_reference: "fixture:normalization" },
        { field: "bad", value: "ignored", reason: "bad source", source_type: "unknown", source_reference: "fixture:normalization" },
      ],
    }, { version: BUSINESS_CLASSIFICATION_VERSION });

    expect(result.business_type).toBe("other");
    expect(result.business_model).toBe("b2c");
    expect(result.delivery_model).toBe("unknown");
    expect(result.market_scope).toBe("unknown");
    expect(result.technical_orientation).toBe("high");
    expect(result.primary_country_code).toBe("NL");
    expect(result.secondary_categories).toEqual(["SaaS", "CRM"]);
    expect(result.target_customer_types).toEqual(["Teams"]);
    expect(result.location_dependency).toBe(0);
    expect(result.overall_confidence).toBe(1);
    expect(result.field_confidences.business_type_confidence).toBe(1);
    expect(result.evidence).toHaveLength(1);
  });

  it("returns JSON-safe optional evidence fields for snapshot metadata", () => {
    const result = normalizeBusinessClassification({
      business_type: "b2b_saas",
      business_model: "b2b",
      delivery_model: "software",
      market_scope: "global",
      technical_orientation: "medium",
      commerce_type: "subscription",
      primary_category: "workflow software",
      evidence: [{ field: "business_type", value: "b2b_saas", reason: "The product serves business teams.", source_type: "website_text", source_reference: "https://example.test" }],
    }, { version: BUSINESS_CLASSIFICATION_VERSION });

    expect(() => jsonValueSchema.parse({ business_classification: result })).not.toThrow();
    expect(result.evidence[0]).not.toHaveProperty("source_path");
    expect(result.evidence[0]).not.toHaveProperty("excerpt");
  });

  it("keeps a global SaaS product global when an office address is present", async () => {
    const fixture = businessClassificationFixtures.find((item) => item.name === "global SaaS with office");
    if (!fixture) throw new Error("Fixture missing.");
    const result = await classifyProductBusiness(fixture.input);
    expect(result.business_type).toBe("b2b_saas");
    expect(result.market_scope).toBe("global");
    expect(result.primary_country_code).toBe("NL");
    expect(result.primary_city).toBe("Amsterdam");
    expect(result.location_dependency).toBeLessThan(0.2);
  });

  it("uses the structured LLM port with an explicit schema and untrusted-text boundary", async () => {
    let received: { schemaName: string; systemPrompt: string; userPrompt: string; jsonSchema?: Record<string, unknown>; maxOutputTokens?: number; temperature?: number } | undefined;
    const provider = {
      async generateStructured<T>(request: { schemaName: string; systemPrompt: string; userPrompt: string }) {
        received = request;
        return {
          value: {
            business_type: "developer_tool",
            business_model: "b2b",
            delivery_model: "software",
            market_scope: "global",
            technical_orientation: "high",
            commerce_type: "subscription",
            primary_category: "developer tools",
            secondary_categories: [],
            target_customer_types: ["developers"],
            buyer_roles: ["engineering leader"],
            end_user_types: ["software engineers"],
            primary_country_code: null,
            primary_region: null,
            primary_city: null,
            location_dependency: 0,
            overall_confidence: 0.8,
            field_confidences: {
              business_type_confidence: 0.8,
              business_model_confidence: 0.8,
              market_scope_confidence: 0.7,
              category_confidence: 0.8,
              delivery_model_confidence: 0.8,
              technical_orientation_confidence: 0.9,
              commerce_type_confidence: 0.7,
              audience_confidence: 0.7,
            },
            evidence: [{ field: "business_type", value: "developer_tool", reason: "API and SDK language", source_type: "website_text", source_reference: "fixture:llm" }],
          } as T,
          provider: "test-provider",
          model: "test-model",
          promptVersion: "test-prompt",
        };
      },
    };
    const engine = new StructuredLlmBusinessClassificationEngine(provider);
    const result = await classifyProductBusiness({ productName: "API Kit", snapshotText: "API and SDK for developers.", sourceReference: "fixture:llm" }, engine);
    expect(result.business_type).toBe("developer_tool");
    expect(received?.schemaName).toBe("BusinessClassificationV1");
    expect(received?.jsonSchema).toMatchObject({ type: "object", properties: expect.any(Object) });
    expect(received?.maxOutputTokens).toBe(1_200);
    expect(received?.temperature).toBe(0);
    expect(received?.systemPrompt).toContain("untrusted data");
    expect(received?.userPrompt).toContain("API and SDK");
  });

  it("makes classification failures non-blocking for the product-understanding caller", async () => {
    const failingEngine = {
      engineType: "classification" as const,
      version: BUSINESS_CLASSIFICATION_VERSION,
      async classify() { throw new Error("provider unavailable"); },
    };
    const result = await tryClassifyProductBusiness({ productName: "Unknown", snapshotText: "Text", sourceReference: "fixture:failure" }, failingEngine);
    expect(result).toBeNull();
  });

  it("stores classification in immutable snapshot metadata and recomputes on version change", async () => {
    const repository = new InMemoryIntelligenceRepository();
    const service = new IntelligenceService(repository);
    const engine = new FixtureBusinessClassificationEngine();
    const classification = await classifyProductBusiness(businessClassificationFixtures[0].input, engine);
    const first = await service.createSnapshot(product, { pageType: "manual", rawText: "B2B CRM software for teams.", businessClassification: classification });
    const retry = await service.createSnapshot(product, { pageType: "manual", rawText: "B2B CRM software for teams.", businessClassification: classification });
    const nextClassification = { ...classification, classification_version: "business-classification-v2" };
    const replay = await service.createSnapshot(product, { pageType: "manual", rawText: "B2B CRM software for teams.", businessClassification: nextClassification });
    expect(retry.id).toBe(first.id);
    expect(replay.id).not.toBe(first.id);
    expect(readBusinessClassificationModel(replay)?.business_type).toBe("b2b_saas");
    expect(replay.content_hash).toBe(sha256Text("B2B CRM software for teams."));
  });
});
