import { describe, expect, it } from "vitest";

import { formatScore, safeExternalUrl, sourceLabel } from "../../src/components/dashboard/dashboard-utils";
import { deriveProductUnderstanding } from "../../src/components/onboarding/product-understanding";

type UnderstandingSnapshot = Parameters<typeof deriveProductUnderstanding>[0];

function snapshotWithProfile(profile: Record<string, unknown>): UnderstandingSnapshot {
  return {
    metadata: {
      demand_profile_v2: {
        switching_triggers: [],
        buying_intents: [],
        problems: [],
        comparison_terms: [],
        competitors: { known_competitors: [], detected_competitor_candidates: [] },
        alternatives: [],
        feature_demands: [],
        jobs_to_be_done: [],
        language: { category_terms: [] },
        ...profile,
      },
    },
  } as unknown as UnderstandingSnapshot;
}

describe("dashboard display helpers", () => {
  it("formats backend scores without changing their meaning", () => {
    expect(formatScore(0.82)).toBe("82%");
  });

  it("only allows safe HTTP(S) source links", () => {
    expect(safeExternalUrl("https://example.com/post")).toBe("https://example.com/post");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("not a URL")).toBeNull();
  });

  it("keeps provider labels generic", () => {
    expect(sourceLabel("hacker_news")).toBe("Hacker News");
  });

  it("prefers persisted profile understanding and meaningful demand concepts", () => {
    const result = deriveProductUnderstanding({
      id: "snapshot-1",
      workspace_id: "workspace-1",
      product_id: "product-1",
      evidence_node_id: "evidence-1",
      snapshot_version: 1,
      page_type: "manual",
      source_url: "https://checkoutleak.com",
      raw_text: "CheckoutLeak helps ecommerce teams recover failed checkout revenue.",
      normalized_text: "CheckoutLeak helps ecommerce teams recover failed checkout revenue.",
      content_hash: "hash",
      metadata: {
        business_classification: { business_type: "b2b_saas", primary_category: "checkout recovery" },
        demand_profile_v2: {
          version: "demand_profile_v2",
          identity: { product_name: "CheckoutLeak", company_name: null, primary_category: "checkout recovery", secondary_categories: [], business_type: "b2b_saas", business_model: "b2b", delivery_model: "software", technical_orientation: "medium", market_scope: "global" },
          audience: { target_customer_types: ["business", "software_development_teams", "ecommerce teams"], buyer_roles: ["product_manager"], end_user_types: ["store operators"], company_size_segments: [], industry_segments: ["ecommerce"] },
          problems: [{ key: "failed_checkouts", label: "failed checkouts", description: "Recover revenue lost when checkout attempts fail.", severity_hint: null, specificity: 0.9, confidence: 0.9, evidence: [] }],
          desired_outcomes: [],
          jobs_to_be_done: [{ key: "recover_checkout_revenue", job: "Recover revenue from failed checkout attempts.", actor: "ecommerce teams", desired_result: "reduce abandoned revenue", context: null, confidence: 0.9, evidence: [] }],
          switching_triggers: [{ key: "lost_revenue", trigger: "lost checkout revenue", description: "Revenue loss prompts evaluation.", confidence: 0.8, evidence: [] }],
          buying_intents: [{ intent_type: "problem_solution_search", relevance: 0.8, reason: "Problem is explicit.", evidence: [] }],
          feature_demands: [],
          objections: [],
          language: { category_terms: ["checkout recovery"], pain_phrases: [], outcome_phrases: [], switching_phrases: [], comparison_phrases: [], recommendation_phrases: [], feature_terms: [] },
          competitors: { known_competitors: [], detected_competitor_candidates: [] },
          alternatives: [],
          comparison_terms: [],
          geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
          confidence: { overall_profile_confidence: 0.88, audience: 0.9, problems: 0.9, outcomes: 0.5, jtbd: 0.9, switching: 0.8, feature_demand: 0.2, competitors: 0.2, alternatives: 0.2, language: 0.8, geography: 0.7 },
          evidence: [],
          engine_version_id: null,
          provider: "openai",
          model: "gpt-4.1-mini",
          prompt_version: "demand_profile_v2",
        },
      },
      capture_status: "captured",
      capture_engine_version_id: null,
      created_at: "2026-09-20T00:00:00.000Z",
      captured_at: "2026-09-20T00:00:00.000Z",
    });
    expect(result.isDerived).toBe(true);
    expect(result.whatYouDo).toContain("recover revenue");
    expect(result.whoItsFor).toEqual(["Software development teams", "Ecommerce teams", "Product managers"]);
    expect(result.whoItsFor).not.toContain("Business");
    expect(result.watchingFor).toEqual(expect.arrayContaining(["Failed checkouts", "Lost checkout revenue", "Reduce abandoned revenue"]));
    expect(result.watchingFor).not.toContain("problem solution search");
  });

  it("ranks commercial signals and prefers a comparison over its standalone competitor", () => {
    const result = deriveProductUnderstanding(snapshotWithProfile({
      switching_triggers: [{ trigger: "switching_from_jira", confidence: 0.9 }],
      buying_intents: [{ intent_type: "comparison_intent", reason: "Teams compare Jira and Linear.", relevance: 0.9 }],
      problems: [{ label: "inefficient software development workflows", confidence: 0.9 }],
      comparison_terms: [{ term: "Jira vs Linear", confidence: 0.9 }],
      competitors: { known_competitors: [{ name: "Jira", confidence: 0.9 }], detected_competitor_candidates: [] },
      alternatives: [{ label: "spreadsheets", confidence: 0.8 }],
      feature_demands: [{ feature: "project_management_features", confidence: 0.8 }],
      jobs_to_be_done: [{ desired_result: "plan build and ship software efficiently", job: "Plan, build, and ship software efficiently.", confidence: 0.8 }],
      language: { category_terms: ["productivity software"] },
    }));

    expect(result.watchingFor.slice(0, 4)).toEqual([
      "Switching from Jira",
      "Teams compare Jira and Linear.",
      "Inefficient software development workflows",
      "Jira vs Linear",
    ]);
    expect(result.watchingFor).not.toContain("Jira");
    expect(result.watchingFor).toContain("Project management features");
    expect(result.watchingFor.length).toBeLessThanOrEqual(6);
  });

  it("removes generic and semantically overlapping concepts without filling the list", () => {
    const genericOnly = deriveProductUnderstanding(snapshotWithProfile({
      problems: [{ label: "Business software", confidence: 0.9 }],
      feature_demands: [{ feature: "Project management", confidence: 0.9 }],
      buying_intents: [{ intent_type: "problem_solution_search", reason: "Problem is explicit.", relevance: 0.9 }],
      language: { category_terms: ["Productivity software", "Workflow tools"] },
    }));
    expect(genericOnly.watchingFor).toEqual([]);

    const overlapping = deriveProductUnderstanding(snapshotWithProfile({
      problems: [{ label: "Better collaboration", confidence: 0.9 }],
      feature_demands: [{ feature: "Better collaboration and workflow tools", confidence: 0.9 }],
    }));
    expect(overlapping.watchingFor).toEqual(["Better collaboration"]);
  });
});
