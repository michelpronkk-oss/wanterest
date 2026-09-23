import { describe, expect, it } from "vitest";

import type { ConversationAnalysisRow, ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { qualifySignal, type SignalQualificationInput } from "../../src/server/modules/intelligence";

const productId = deterministicUuid("directional-demand-product");

function inputFor(body: string, options: { productName?: string; repository?: string; authorAssociation?: string } = {}): SignalQualificationInput {
  const productName = options.productName ?? "Linear";
  const conversationId = deterministicUuid(`directional-demand-conversation:${body}:${productName}`);
  const sourceId = deterministicUuid(`directional-demand-source:${body}:${productName}`);
  const metadata = {
    ...(options.repository ? { repository: options.repository, repositoryName: options.repository.split("/").at(-1) } : {}),
    ...(options.authorAssociation ? { authorAssociation: options.authorAssociation } : {}),
  };
  const source: SourceItemRow = {
    id: sourceId,
    evidence_node_id: deterministicUuid(`directional-demand-source-evidence:${sourceId}`),
    source_key: "github",
    external_id: `directional-demand:${sourceId}`,
    external_conversation_id: conversationId,
    canonical_url: "https://github.com/example/project/discussions/1",
    author_external_id: "github:user:1",
    author_display_name: "author",
    author_profile_url: null,
    title: null,
    body,
    published_at: "2026-09-23T00:00:00.000Z",
    captured_at: "2026-09-23T00:00:00.000Z",
    language: "en",
    metadata,
    content_hash: sha256Text(body),
    latest_raw_source_item_id: deterministicUuid(`directional-demand-raw:${sourceId}`),
    normalization_version: "fixture-v1",
    status: "active",
    created_at: "2026-09-23T00:00:00.000Z",
    updated_at: "2026-09-23T00:00:00.000Z",
  };
  const conversation: ConversationRow = {
    id: conversationId,
    evidence_node_id: deterministicUuid(`directional-demand-conversation-evidence:${conversationId}`),
    conversation_key: `fixture:directional-demand:${conversationId}`,
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
    canonicalization_version: "fixture-v1",
    created_at: source.created_at,
    updated_at: source.updated_at,
  };
  const analysis: ConversationAnalysisRow = {
    id: deterministicUuid(`directional-demand-analysis:${conversationId}`),
    conversation_id: conversationId,
    evidence_node_id: deterministicUuid(`directional-demand-analysis-evidence:${conversationId}`),
    engine_version_id: deterministicUuid("directional-demand-analysis-engine"),
    input_fingerprint: sha256Text(`directional-demand-analysis:${conversationId}`),
    intent_type: "switching_intent",
    pain_themes: ["workflow pain"],
    desired_outcomes: [],
    alternatives: ["Jira"],
    buyer_language: ["we need"],
    audience_signals: ["engineering team"],
    specificity: 0.85,
    urgency: null,
    confidence: 0.9,
    status: "completed",
    skip_reason: null,
    evidence_spans: [],
    provider: "fixture",
    model: "deterministic",
    prompt_version: "fixture-v1",
    usage_metadata: {},
    created_at: source.created_at,
  };
  return {
    candidateId: conversationId,
    productId,
    productName,
    conversation,
    sourceItem: source,
    analysis,
    match: {
      decision: "qualified",
      matchConfidence: 0.92,
      rationale: "Fixture match.",
      evidence: { painAlignment: ["workflow"], buyerAlignment: ["engineering team"], capabilityAlignment: [], intentRelevance: ["switching_intent"] },
    },
    profile: {
      relevant_pains: ["workflow"],
      relevant_outcomes: ["faster issue tracking"],
      relevant_intents: [{ intent_type: "switching_intent", relevance: 0.9 }],
      relevant_jtbd: ["manage engineering work"],
      relevant_features: ["importer"],
      buyer_roles: ["engineering team"],
      competitors: [{ name: "Jira", confidence: 0.95 }],
      alternatives: [{ label: "spreadsheet", alternative_type: "manual_process", confidence: 0.8 }],
      geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
      profile_confidence: 0.95,
      primary_category: "issue tracking software",
      profile_version: "demand_profile_v2",
    },
    now: new Date("2026-09-23T00:00:00.000Z"),
  };
}

describe("directional demand semantics", () => {
  it("recognizes movement from Jira toward Linear as positive Linear demand", () => {
    const result = qualifySignal(inputFor("We are leaving Jira and moving to Linear."));

    expect(result.demand_direction).toBe("toward_product");
    expect(result.demand_target_type).toBe("scanned_product");
    expect(result.demand_target_name).toBe("Linear");
    expect(result.source_products).toContain("Jira");
    expect(result.market_context.version).toBe("market_context_v1");
    expect(result.conversation_reasoning.direction_relative_to_scanned_product).toBe("toward_product");
    expect(["qualified", "high_confidence_signal"]).toContain(result.status);
  });

  it("recognizes movement away from Linear and blocks positive Linear qualification", () => {
    const result = qualifySignal(inputFor("We are leaving Linear and moving to Orbit.", { repository: "Noveum/orbit" }));

    expect(result.demand_direction).toBe("away_from_product");
    expect(result.demand_target_type).toBe("third_party_product");
    expect(result.demand_target_name).toBe("Orbit");
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });

  it("records an unpromoted competitor candidate when a named product is evaluated away from Linear", () => {
    const result = qualifySignal(inputFor("Linear is too expensive; we are evaluating Plane."));

    expect(result.demand_direction).toBe("away_from_product");
    expect(result.demand_target_name).toBe("Plane");
    expect(result.conversation_reasoning.relationship_candidates).toEqual([{ entity_name: "Plane", relationship_type: "direct_competitor", confidence: 0.7, evidence_count: 1 }]);
    expect(result.status).not.toBe("qualified");
  });

  it("treats Jira-alternative feature parity in a host repository as third-party demand", () => {
    const result = qualifySignal(inputFor("Awesome Jira alternative. Do you plan Jira-like transition screens?", { repository: "acme/product-a" }));

    expect(result.demand_direction).toBe("contextual");
    expect(result.demand_target_type).toBe("third_party_product");
    expect(result.demand_target_name).toBe("Product-a");
    expect(result.source_products).toContain("Jira");
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });

  it("keeps an explicitly evaluated Linear destination positive", () => {
    const result = qualifySignal(inputFor("We are evaluating Linear as a Jira alternative."));

    expect(result.demand_direction).toBe("toward_product");
    expect(result.demand_target_type).toBe("scanned_product");
    expect(result.demand_target_name).toBe("Linear");
    expect(["qualified", "high_confidence_signal"]).toContain(result.status);
  });

  it("recognizes an explicitly named non-scanned host product as the destination", () => {
    const result = qualifySignal(inputFor("We are evaluating Product A as a Jira alternative.", { repository: "acme/product-a" }));

    expect(result.demand_direction).toBe("contextual");
    expect(result.demand_target_type).toBe("third_party_product");
    expect(result.demand_target_name).toBe("Product-a");
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });

  it("treats a third-party product feature request as contextual rather than Linear demand", () => {
    const result = qualifySignal(inputFor("Orbit needs an importer for teams migrating from Jira or Linear.", { repository: "Noveum/orbit" }));

    expect(result.demand_direction).toBe("contextual");
    expect(result.demand_target_type).toBe("third_party_product");
    expect(result.demand_target_name).toBe("Orbit");
    expect(result.source_products).toEqual(expect.arrayContaining(["Jira", "Linear"]));
    expect(result.status).not.toBe("qualified");
    expect(result.qualification_reason).toMatch(/migrate existing work into Orbit/i);
  });

  it("classifies the Orbit Jira-parity discussion as host-product context", () => {
    const result = qualifySignal(inputFor("First of all, big thanks to you! Awesome Jira alternative from the beginning. But I wonder if there is roadmap somewhere? For example i wonder do you have transition screens in that roadmap and other Jira like features?", { repository: "Noveum/orbit" }));

    expect(result.demand_direction).toBe("contextual");
    expect(result.demand_target_type).toBe("third_party_product");
    expect(result.demand_target_name).toBe("Orbit");
    expect(result.source_products).toContain("Jira");
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
    expect(result.qualification_reason).toMatch(/evaluating Orbit as a Jira alternative/i);
  });

  it("keeps an alternative to a competitor as potentially relevant category demand", () => {
    const result = qualifySignal(inputFor("We need an alternative to Jira for our engineering team."));

    expect(result.demand_direction).toBe("toward_category");
    expect(result.demand_target_type).toBe("category");
    expect(result.source_products).toContain("Jira");
    expect(["qualified", "high_confidence_signal"]).toContain(result.status);
  });

  it("keeps OAuth alternatives in the implementation target, not product switching", () => {
    const result = qualifySignal(inputFor("We need an alternative OAuth method for Jira."));

    expect(result.intent_target).toBe("authentication");
    expect(result.demand_target_type).toBe("implementation");
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });

  it("marks maintainer roadmap context without fabricating buyer certainty", () => {
    const result = qualifySignal(inputFor("We are planning migration support for Jira.", { repository: "linear/linear", authorAssociation: "MEMBER" }));

    expect(result.speaker_role).toBe("maintainer");
    expect(result.dimensions.buyer_plausibility).toBeLessThanOrEqual(0.5);
  });

  it("does not treat host-product Jira parity discussion as buyer demand for Linear", () => {
    const result = qualifySignal(inputFor("Maintainer roadmap discussion: Jira-like feature parity is planned for this project.", { repository: "acme/product-a", authorAssociation: "MEMBER" }));

    expect(result.speaker_role).toBe("maintainer");
    expect(result.demand_target_type).toBe("third_party_product");
    expect(result.status).not.toBe("qualified");
    expect(result.status).not.toBe("high_confidence_signal");
  });
});
