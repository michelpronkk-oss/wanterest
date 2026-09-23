import { describe, expect, it } from "vitest";

import { jsonValueSchema, type ConversationAnalysisRow, type ConversationRow, type SourceItemRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { qualifySignal, type ProductMatchResult, type SignalQualificationProfile } from "../../src/server/modules/intelligence";

// Regression coverage for the product relevance fix: relevance previously answered "how
// explicitly does this conversation name the product" (dominated 65% by a keyword/token-
// overlap match score) rather than "how strongly does this represent demand that could
// materially matter to this product". Explicit competitor pain and category-level switching
// demand repeatedly scored 0.38-0.58, below the frozen 0.65 qualification threshold, even
// with strong intent/evidence/specificity. These cases use a generic Linear-like product
// profile — nothing here is specific to any hardcoded product/competitor name; the same
// mechanism (matched competitors/pains/features from the product's own structured
// understanding, described generically in signal-qualification.schemas.ts) applies to any
// product's demand profile.

const productId = deterministicUuid("relevance-fix-product");

function issueTrackerProfile(): SignalQualificationProfile {
  return {
    relevant_pains: [
      { key: "engineering_workflows_painful", label: "engineering workflows painful", confidence: 0.85 },
      { key: "manual_issue_tracking", label: "manual issue tracking", confidence: 0.8 },
    ],
    relevant_outcomes: [{ key: "faster_issue_tracking", label: "faster issue tracking", confidence: 0.85 }],
    relevant_intents: [{ intent_type: "switching_intent", relevance: 0.9 }, { intent_type: "alternative_search", relevance: 0.9 }],
    relevant_jtbd: [{ key: "track_engineering_work", job: "track engineering work", desired_result: "ship faster with less overhead", confidence: 0.85 }],
    relevant_features: [{ key: "issue_tracker", feature: "issue tracker", confidence: 0.85 }, { key: "cycles", feature: "cycles", confidence: 0.8 }, { key: "workflow_automation", feature: "workflow automation", confidence: 0.8 }],
    buyer_roles: ["engineering manager", "product manager"],
    competitors: [{ key: "jira", name: "Jira", confidence: 0.95 }],
    alternatives: [{ key: "spreadsheet_tracking", label: "spreadsheet tracking", alternative_type: "manual_process", confidence: 0.7 }],
    geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
    profile_confidence: 0.9,
    primary_category: "issue tracking software",
    profile_version: "demand_profile_v2",
  };
}

type Case = {
  name: string;
  body: string;
  analysisIntent: string;
  painThemes?: string[];
  buyerLanguage?: string[];
  audienceSignals?: string[];
  specificity?: number;
  confidence?: number;
  matchConfidence?: number;
  matchDecision?: "qualified" | "weak" | "rejected";
};

function inputFor(testCase: Case): Parameters<typeof qualifySignal>[0] {
  const sourceId = deterministicUuid(`relevance-fix-source:${testCase.name}`);
  const conversationId = deterministicUuid(`relevance-fix-conversation:${testCase.name}`);
  const body = testCase.body;
  const metadata = jsonValueSchema.parse({});
  const source: SourceItemRow = {
    id: sourceId,
    evidence_node_id: deterministicUuid(`relevance-fix-source-evidence:${testCase.name}`),
    source_key: "fixture",
    external_id: `relevance-fix:${testCase.name}`,
    external_conversation_id: conversationId,
    canonical_url: "https://example.com/post",
    author_external_id: "fixture:user",
    author_display_name: "Fixture author",
    author_profile_url: null,
    title: null,
    body,
    published_at: "2026-09-19T00:00:00.000Z",
    captured_at: "2026-09-20T00:00:00.000Z",
    language: "en",
    metadata,
    content_hash: sha256Text(body),
    latest_raw_source_item_id: deterministicUuid(`relevance-fix-raw:${testCase.name}`),
    normalization_version: "fixture-v1",
    status: "active",
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
  const conversation: ConversationRow = {
    id: conversationId,
    evidence_node_id: deterministicUuid(`relevance-fix-conversation-evidence:${testCase.name}`),
    conversation_key: `fixture:relevance-fix:${testCase.name}`,
    primary_source_item_id: sourceId,
    canonical_url: source.canonical_url,
    author_external_id: source.author_external_id,
    author_display_name: source.author_display_name,
    author_profile_url: source.author_profile_url,
    title: source.title,
    body,
    published_at: source.published_at,
    last_activity_at: source.published_at,
    captured_at: source.captured_at,
    language: source.language,
    metadata,
    content_hash: source.content_hash,
    canonicalization_version: "canonical-v1",
    created_at: source.created_at,
    updated_at: source.updated_at,
  };
  const analysis: ConversationAnalysisRow = {
    id: deterministicUuid(`relevance-fix-analysis:${testCase.name}`),
    conversation_id: conversation.id,
    evidence_node_id: deterministicUuid(`relevance-fix-analysis-evidence:${testCase.name}`),
    engine_version_id: deterministicUuid("relevance-fix-analysis-engine"),
    input_fingerprint: sha256Text(`relevance-fix-analysis:${testCase.name}`),
    intent_type: testCase.analysisIntent,
    pain_themes: testCase.painThemes ?? [],
    desired_outcomes: [],
    alternatives: [],
    buyer_language: testCase.buyerLanguage ?? [],
    audience_signals: testCase.audienceSignals ?? [],
    specificity: testCase.specificity ?? 0.35,
    urgency: null,
    confidence: testCase.confidence ?? 0.8,
    status: "completed",
    skip_reason: null,
    evidence_spans: [],
    provider: "fixture",
    model: "deterministic",
    prompt_version: "fixture-v1",
    usage_metadata: {},
    created_at: source.created_at,
  };
  const match: ProductMatchResult = {
    decision: testCase.matchDecision ?? "weak",
    matchConfidence: testCase.matchConfidence ?? 0.5,
    rationale: "Fixture match for relevance regression coverage.",
    evidence: { painAlignment: testCase.painThemes ?? [], buyerAlignment: testCase.audienceSignals ?? [], capabilityAlignment: [], intentRelevance: [testCase.analysisIntent] },
  };
  return { candidateId: conversation.id, productId, productName: "Streamline", conversation, sourceItem: source, analysis, match, profile: issueTrackerProfile(), now: new Date("2026-09-20T00:00:00.000Z") };
}

describe("Product relevance — competitor and category demand", () => {
  it("A: explicit competitor pain + switching language can reach the qualification threshold", () => {
    const result = qualifySignal(inputFor({
      name: "competitor-pain-switching",
      body: "Jira is becoming too slow and complicated for our engineering team. We're looking for a simpler issue tracker.",
      analysisIntent: "switching_intent",
      painThemes: ["slow and complicated workflow"],
      buyerLanguage: ["We're looking for a simpler issue tracker"],
      audienceSignals: ["engineering team"],
      specificity: 0.8,
      confidence: 0.82,
      matchConfidence: 0.5,
      matchDecision: "weak",
    }));
    expect(result.dimensions.product_relevance).toBeGreaterThanOrEqual(0.65);
  });

  it("B: explicit switching-away-from-competitor demand can reach the qualification threshold", () => {
    const result = qualifySignal(inputFor({
      name: "moving-away-alternatives",
      body: "We want to move away from Jira. What are good alternatives for software teams?",
      analysisIntent: "switching_intent",
      painThemes: ["engineering workflows painful"],
      buyerLanguage: ["We want to move away from Jira"],
      audienceSignals: ["software teams"],
      specificity: 0.78,
      confidence: 0.8,
      matchConfidence: 0.62,
      matchDecision: "qualified",
    }));
    expect(result.dimensions.product_relevance).toBeGreaterThanOrEqual(0.65);
  });

  it("C: category-level workflow pain with clear buyer intent can reach the qualification threshold", () => {
    const result = qualifySignal(inputFor({
      name: "category-workflow-pain",
      body: "Our current issue tracker makes engineering workflows painful. Need something faster for product/dev teams.",
      analysisIntent: "high_intent",
      painThemes: ["engineering workflows painful"],
      buyerLanguage: ["Need something faster"],
      audienceSignals: ["product/dev teams"],
      specificity: 0.75,
      confidence: 0.78,
      matchConfidence: 0.55,
      matchDecision: "weak",
    }));
    expect(result.dimensions.product_relevance).toBeGreaterThanOrEqual(0.65);
  });

  it("D: generic project-management chatter with no buying/category context stays well below threshold", () => {
    const result = qualifySignal(inputFor({
      name: "generic-pm-chatter",
      body: "Project management is an important skill for students.",
      analysisIntent: "informational",
      specificity: 0.1,
      confidence: 0.4,
      matchConfidence: 0.2,
      matchDecision: "rejected",
    }));
    expect(result.dimensions.product_relevance).toBeLessThan(0.65);
  });

  it("E: generic productivity listicle stays well below threshold", () => {
    const result = qualifySignal(inputFor({
      name: "productivity-listicle",
      body: "Here are 10 productivity tools you should try.",
      analysisIntent: "informational",
      specificity: 0.1,
      confidence: 0.4,
      matchConfidence: 0.2,
      matchDecision: "rejected",
    }));
    expect(result.dimensions.product_relevance).toBeLessThan(0.65);
  });

  it("F: a competitor keyword in an unrelated implementation-detail request (no buyer/category demand) stays below threshold", () => {
    // "Jira" is a known competitor and would literally match as a profile concept, but there
    // is no switching/alternative/need/looking-for language — no commercial intent at all —
    // so this must not be treated as competitor demand just because the word appears.
    const result = qualifySignal(inputFor({
      name: "unrelated-jira-integration-detail",
      body: "Add OAuth authentication to this unrelated Jira API integration.",
      analysisIntent: "informational",
      specificity: 0.3,
      confidence: 0.5,
      matchConfidence: 0.3,
      matchDecision: "rejected",
    }));
    expect(result.dimensions.product_relevance).toBeLessThan(0.65);
  });

  it("direct product demand still reaches high relevance without a competitor mention", () => {
    const result = qualifySignal(inputFor({
      name: "direct-product-demand",
      body: "Looking for an issue tracker for our engineering team. What do you recommend?",
      analysisIntent: "high_intent",
      buyerLanguage: ["Looking for an issue tracker"],
      audienceSignals: ["engineering team"],
      specificity: 0.75,
      confidence: 0.82,
      matchConfidence: 0.9,
      matchDecision: "qualified",
    }));
    expect(result.dimensions.product_relevance).toBeGreaterThanOrEqual(0.65);
  });
});
