import { describe, expect, it } from "vitest";

import { jsonValueSchema, type ConversationAnalysisRow, type ConversationRow, type SourceItemRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { failClosedQualification, formatSignalQualificationCalibration, inspectSignalContent, isDuplicateSignalContent, normalizeDestinationUrl, qualifySignal, signalQualificationFixtures, type ProductMatchResult, type SignalQualificationFixture, type SignalQualificationProfile } from "../../src/server/modules/intelligence";

const productId = deterministicUuid("signal-qualification-product");

function profileFor(fixture: SignalQualificationFixture): SignalQualificationProfile {
  if (fixture.profileKind === "local_dentist") return {
    relevant_pains: [{ key: "anxious_patients", label: "anxious patients", confidence: 0.9 }],
    relevant_outcomes: [{ key: "accessible_dental_care", label: "accessible dental care", confidence: 0.9 }],
    relevant_intents: [{ intent_type: "recommendation_request", relevance: 0.9 }],
    relevant_jtbd: [{ key: "find_dentist", job: "find a dentist", desired_result: "get local dental care", confidence: 0.9 }],
    relevant_features: [],
    buyer_roles: ["patient"],
    competitors: [],
    alternatives: [],
    geography: { market_scope: "local", primary_country_code: "NL", primary_region: "Noord-Holland", primary_city: "Hoorn", location_dependency: 0.95, demand_geography_terms: ["Hoorn"] },
    profile_confidence: 0.9,
    primary_category: "dentist",
    profile_version: "demand_profile_v2",
  };
  if (fixture.profileKind === "running_shoes") return {
    relevant_pains: [{ key: "poor_comfort", label: "poor comfort", confidence: 0.9 }],
    relevant_outcomes: [{ key: "comfortable_running", label: "comfortable running", confidence: 0.9 }],
    relevant_intents: [{ intent_type: "recommendation_request", relevance: 0.8 }],
    relevant_jtbd: [{ key: "run_comfortably", job: "run comfortably", desired_result: "finish long runs without pain", confidence: 0.9 }],
    relevant_features: [{ key: "wide_fit", feature: "wide fit", confidence: 0.9 }],
    buyer_roles: ["runner"],
    competitors: [],
    alternatives: [],
    geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
    profile_confidence: 0.9,
    primary_category: "running shoes",
    profile_version: "demand_profile_v2",
  };
  return {
    relevant_pains: [{ key: "high_software_cost", label: "high software cost", confidence: 0.9 }, { key: "complex_workflow", label: "complex workflow", confidence: 0.85 }, { key: "manual_reporting", label: "manual reporting", confidence: 0.9 }],
    relevant_outcomes: [{ key: "simpler_crm", label: "simpler CRM", confidence: 0.9 }, { key: "visible_followups", label: "visible follow-ups", confidence: 0.85 }],
    relevant_intents: [{ intent_type: "alternative_search", relevance: 0.9 }, { intent_type: "switching_intent", relevance: 0.9 }, { intent_type: "recommendation_request", relevance: 0.8 }],
    relevant_jtbd: [{ key: "manage_sales_followups", job: "manage sales follow-ups", desired_result: "keep follow-ups visible", confidence: 0.9 }],
    relevant_features: [{ key: "sso", feature: "SSO", confidence: 0.9 }, { key: "api_integrations", feature: "API integrations", confidence: 0.9 }],
    buyer_roles: ["sales manager", "founder"],
    competitors: [{ key: "hubspot", name: "HubSpot", confidence: 0.95 }, { key: "salesforce", name: "Salesforce", confidence: 0.9 }],
    alternatives: [{ key: "spreadsheet", label: "spreadsheet", alternative_type: "manual_process", confidence: 0.8 }],
    geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
    profile_confidence: 0.9,
    primary_category: "CRM",
    profile_version: "demand_profile_v2",
  };
}

function inputFor(fixture: SignalQualificationFixture): { input: Parameters<typeof qualifySignal>[0]; source: SourceItemRow } {
  const sourceId = deterministicUuid(`signal-qualification-source:${fixture.name}`);
  const conversationId = deterministicUuid(`signal-qualification-conversation:${fixture.name}`);
  const body = fixture.body;
  const metadata = jsonValueSchema.parse(fixture.metadata ?? {});
  const source: SourceItemRow = {
    id: sourceId,
    evidence_node_id: deterministicUuid(`signal-qualification-source-evidence:${fixture.name}`),
    source_key: fixture.sourceKey ?? "fixture",
    external_id: `signal-qualification:${fixture.name}`,
    external_conversation_id: conversationId,
    canonical_url: fixture.name === "link only" ? "https://example.com/crm" : "https://example.com/post",
    author_external_id: "fixture:user",
    author_display_name: "Fixture author",
    author_profile_url: null,
    title: fixture.title ?? null,
    body,
    published_at: "2026-09-19T00:00:00.000Z",
    captured_at: "2026-09-20T00:00:00.000Z",
    language: "en",
    metadata,
    content_hash: sha256Text(body),
    latest_raw_source_item_id: deterministicUuid(`signal-qualification-raw:${fixture.name}`),
    normalization_version: "fixture-v1",
    status: "active",
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
  const conversation: ConversationRow = {
    id: conversationId,
    evidence_node_id: deterministicUuid(`signal-qualification-conversation-evidence:${fixture.name}`),
    conversation_key: `fixture:signal-qualification:${fixture.name}`,
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
    id: deterministicUuid(`signal-qualification-analysis:${fixture.name}`),
    conversation_id: conversation.id,
    evidence_node_id: deterministicUuid(`signal-qualification-analysis-evidence:${fixture.name}`),
    engine_version_id: deterministicUuid("signal-qualification-analysis-engine"),
    input_fingerprint: sha256Text(`signal-qualification-analysis:${fixture.name}`),
    intent_type: fixture.analysisIntent ?? "unknown",
    pain_themes: fixture.painThemes ?? [],
    desired_outcomes: [],
    alternatives: [],
    buyer_language: fixture.buyerLanguage ?? [],
    audience_signals: fixture.audienceSignals ?? [],
    specificity: fixture.specificity ?? 0.35,
    urgency: null,
    confidence: fixture.confidence ?? 0.88,
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
    decision: fixture.matchDecision ?? "qualified",
    matchConfidence: fixture.matchConfidence ?? 0.9,
    rationale: "Fixture match for qualification calibration.",
    evidence: { painAlignment: fixture.painThemes ?? [], buyerAlignment: fixture.audienceSignals ?? [], capabilityAlignment: [], intentRelevance: [fixture.analysisIntent ?? "unknown"] },
  };
  return { source, input: { candidateId: conversation.id, productId, productName: fixture.profileKind === "local_dentist" ? "Hoorn Dental Care" : "Calmer CRM", conversation, sourceItem: source, analysis, match, profile: profileFor(fixture), now: new Date("2026-09-20T00:00:00.000Z") } };
}

describe("Signal Qualification v1", () => {
  it("classifies the calibration fixtures without allowing weak/rejected content into Signal status", () => {
    for (const fixture of signalQualificationFixtures) {
      const result = qualifySignal(inputFor(fixture).input);
      if (fixture.expected === "qualified_or_high_confidence") expect(["qualified", "high_confidence_signal"]).toContain(result.status);
      else expect(["weak_candidate", "rejected"]).toContain(result.status);
    }
  });

  it("keeps engagement separate from demand quality", () => {
    const viral = qualifySignal(inputFor(signalQualificationFixtures.find((fixture) => fixture.name === "viral meme")!).input);
    const quiet = qualifySignal(inputFor(signalQualificationFixtures.find((fixture) => fixture.name === "strong demand with low engagement")!).input);
    expect(viral.resonance.score).toBeGreaterThan(0.8);
    expect(viral.status).not.toBe("qualified");
    expect(viral.status).not.toBe("high_confidence_signal");
    expect(quiet.resonance.score).toBeLessThan(0.2);
    expect(["qualified", "high_confidence_signal"]).toContain(quiet.status);
  });

  it("requires traceable evidence for qualification", () => {
    const fixture = signalQualificationFixtures[0]!;
    const { input } = inputFor(fixture);
    const result = qualifySignal({ ...input, sourceItem: { ...input.sourceItem, body: "HubSpot" }, conversation: { ...input.conversation, body: "HubSpot" } });
    expect(result.evidence_spans).toHaveLength(0);
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });

  it("changes product relevance for the same demand against an unrelated product", () => {
    const fixture = signalQualificationFixtures[1]!;
    const { input } = inputFor(fixture);
    const relevant = qualifySignal(input);
    const unrelated = qualifySignal({ ...input, productId: deterministicUuid("running-shoes-product"), productName: "Running Shoes", profile: profileFor({ ...fixture, profileKind: "running_shoes" }), match: { ...input.match, decision: "rejected", matchConfidence: 0.15 } });
    expect(relevant.dimensions.product_relevance).toBeGreaterThan(unrelated.dimensions.product_relevance);
    expect(unrelated.status).not.toBe("qualified");
    expect(unrelated.status).not.toBe("high_confidence_signal");
  });

  it("handles local geography without penalizing global profiles", () => {
    const local = qualifySignal(inputFor(signalQualificationFixtures.find((fixture) => fixture.name === "local relevant discussion")!).input);
    const mismatch = qualifySignal(inputFor(signalQualificationFixtures.find((fixture) => fixture.name === "local geographic mismatch")!).input);
    expect(local.reason_codes).toContain("GEO_CONTEXT_MATCH");
    expect(mismatch.reason_codes).toContain("GEO_MISMATCH");
    expect(local.dimensions.product_relevance).toBeGreaterThan(mismatch.dimensions.product_relevance);
  });

  it("is deterministic and fails closed when qualification analysis is unavailable", () => {
    const input = inputFor(signalQualificationFixtures[0]!).input;
    expect(qualifySignal(input)).toEqual(qualifySignal(input));
    const failed = failClosedQualification({ ...input, analysis: { ...input.analysis, status: "failed" } });
    expect(failed.status).toBe("rejected");
    expect(failed.diagnostics.failed).toBe(true);
    expect(failed.reason_codes).toContain("QUALIFICATION_FAILED");
  });

  it("provides a network-free calibration representation", () => {
    const fixture = signalQualificationFixtures[0]!;
    const result = qualifySignal(inputFor(fixture).input);
    const output = formatSignalQualificationCalibration({ source: "fixture", text: fixture.body, qualification: result });
    expect(output).toContain("signal_qualification_v1");
    expect(output).toContain("demand_quality_score");
    expect(output).toContain("evidence_spans");
    expect(output).toContain("resonance");
  });

  it("rejects SEO/editorial switching copy when a source post promotes an external article", () => {
    const fixture = signalQualificationFixtures[1]!;
    const { input } = inputFor(fixture);
    const body = "Linear vs Jira: Why Developer Teams Are Switching in 2026\\n\\nWe moved our engineering workflow from Jira to Linear and tracked how issue resolution time changed over three sprints. Here is what the keyboard-driven project manager gets right.";
    const result = qualifySignal({
      ...input,
      conversation: { ...input.conversation, body },
      sourceItem: { ...input.sourceItem, body, metadata: { embedType: "app.bsky.embed.external", externalUrl: "https://pickuma.com/posts/linear-vs-jira-project-management-developers-2026/?utm_source=bluesky" } },
    });
    expect(result.reason_codes).toContain("PROMOTIONAL_CONTENT");
    expect(result.dimensions.promotional_probability).toBeGreaterThanOrEqual(0.9);
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });

  it("canonicalizes tracking parameters without merging independent first-person demand", () => {
    expect(normalizeDestinationUrl("https://www.example.com/article/?utm_source=bluesky&b=2&a=1#read")).toBe("https://example.com/article?a=1&b=2");
    const left = inputFor(signalQualificationFixtures[1]!).input;
    const right = { ...left, conversation: { ...left.conversation, id: deterministicUuid("independent-switcher"), body: "We are switching from Jira because our team needs simpler workflows." }, sourceItem: { ...left.sourceItem, id: deterministicUuid("independent-switcher-source"), body: "We are switching from Jira because our team needs simpler workflows.", metadata: {} } };
    expect(isDuplicateSignalContent(inspectSignalContent({ conversation: left.conversation, sourceItem: left.sourceItem }), inspectSignalContent({ conversation: right.conversation, sourceItem: right.sourceItem }))).toBe(false);
  });

  it("collapses repeated promotional links and near-identical editorial copy", () => {
    const left = inputFor(signalQualificationFixtures[1]!).input;
    const firstBody = "Linear vs Jira: Why Developer Teams Are Switching in 2026. Learn how teams compare the two tools in this complete guide.";
    const first = inspectSignalContent({ conversation: { ...left.conversation, body: firstBody }, sourceItem: { ...left.sourceItem, body: firstBody, metadata: { embedType: "app.bsky.embed.external", externalUrl: "https://example.com/linear-guide/?utm_source=one" } } });
    const secondBody = "Linear vs Jira: why developer teams are switching in 2026. Read the complete guide to the same workflow comparison.";
    const second = inspectSignalContent({ conversation: { ...left.conversation, body: secondBody }, sourceItem: { ...left.sourceItem, body: secondBody, metadata: { embedType: "app.bsky.embed.external", externalUrl: "https://www.example.com/linear-guide/?utm_medium=social" } } });
    expect(first.promotionalEditorial).toBe(true);
    expect(second.promotionalEditorial).toBe(true);
    expect(isDuplicateSignalContent(first, second)).toBe(true);
  });
});
