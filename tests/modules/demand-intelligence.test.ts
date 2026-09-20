import { describe, expect, it } from "vitest";

import type { DemandProfileRow, ProductRow, ProductSnapshotRow } from "../../src/server/db/database.helpers";
import type { ConversationAnalysisRow, ConversationRow, ProductMatchEvaluationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { InMemoryIntelligenceRepository } from "../../src/server/modules/intelligence";
import { calculateDriftDirection, calculateGapScore, calculateSignificance, FixtureDemandThemeEngine, InMemoryDemandRepository, DemandIntelligenceService, normalizeFacet, sampleFactor } from "../../src/server/modules/demand-intelligence";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const evaluationId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";
const sourceId = "66666666-6666-4666-8666-666666666666";

const product = { id: productId, workspace_id: workspaceId, name: "Workflow Helper", slug: "workflow-helper", website_url: null, status: "active", current_snapshot_id: null, current_demand_profile_id: profileId, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" } as ProductRow;
const profile = { id: profileId, workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid("profile-evidence"), profile_version: 1, audience: [], jobs: [], problems: ["manual work"], desired_outcomes: ["faster reporting"], capabilities: ["automation"], alternatives: [], include_terms: ["manual", "workflow"], exclude_terms: [], languages: ["en"], geographies: [], confidence: 0.85, engine_version_id: deterministicUuid("profile-engine"), model: "fixture", prompt_version: "fixture-v1", created_at: "2026-09-01T00:00:00.000Z" } as DemandProfileRow;
const productSnapshot = { id: deterministicUuid("product-snapshot"), workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid("product-snapshot-evidence"), snapshot_version: 1, source_url: null, page_type: "manual", raw_text: "Workflow automation for teams.", normalized_text: "workflow automation for teams.", content_hash: sha256Text("workflow automation for teams."), metadata: {}, capture_status: "captured", capture_engine_version_id: null, captured_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" } as ProductSnapshotRow;

function seedObservation(repository: InMemoryDemandRepository, input: { id: string; value: string; date: string; conversation: string; intent?: string }) {
  return repository.createObservation({
    id: input.id, workspace_id: workspaceId, product_id: productId, conversation_id: input.conversation,
    product_match_id: deterministicUuid(`match:${input.conversation}`), match_evaluation_id: deterministicUuid(`evaluation:${input.conversation}`),
    conversation_analysis_id: deterministicUuid(`analysis:${input.conversation}`), signal_id: deterministicUuid(`signal:${input.conversation}`), source_key: "fixture",
    evidence_node_id: deterministicUuid(`observation-evidence:${input.id}`), observation_type: "pain", facet_key: "pain_theme", facet_value: input.value,
    normalized_value: normalizeFacet(input.value), intent_type: input.intent ?? "high_intent", weight: 0.9, opportunity_score: 0.8, confidence: 0.9,
    observed_at: input.date, published_at: input.date, analysis_engine_version_id: deterministicUuid("analysis-engine"), match_engine_version_id: deterministicUuid("match-engine"), observation_engine_version_id: deterministicUuid("observation-engine"), input_fingerprint: sha256Text(input.id),
  });
}

describe("Phase 4 demand intelligence", () => {
  it("normalizes phrases and keeps gap/drift formulas bounded and sample-aware", () => {
    expect(normalizeFacet("Copy-paste manually into the CRM")).toBe("copying_manual_into_the_crm");
    expect(calculateGapScore(1, 0, 1, 1)).toBe(1);
    expect(sampleFactor("insufficient_data")).toBe(0.25);
    expect(calculateDriftDirection(0.8, 0.2, 8, 2, true)).toBe("rising");
    expect(calculateDriftDirection(0.8, 0.2, 2, 2, false)).toBe("insufficient_data");
    expect(calculateSignificance(0.3, true)).toBe("strong");
  });

  it("materializes observations through the qualified Phase 3 evidence chain", async () => {
    const intelligence = new InMemoryIntelligenceRepository();
    const repository = new InMemoryDemandRepository();
    const source = { id: sourceId, evidence_node_id: deterministicUuid("source"), source_key: "fixture", external_id: "fixture-1", external_conversation_id: null, canonical_url: "https://example.com/thread", author_external_id: null, author_display_name: null, author_profile_url: null, title: "Manual reporting", body: "I need a tool because manual reporting is slow.", published_at: "2026-09-19T00:00:00.000Z", captured_at: "2026-09-19T00:00:00.000Z", language: "en", metadata: {}, content_hash: sha256Text("manual reporting"), latest_raw_source_item_id: deterministicUuid("raw"), normalization_version: "fixture-v1", status: "active", created_at: "2026-09-19T00:00:00.000Z", updated_at: "2026-09-19T00:00:00.000Z" } as SourceItemRow;
    const conversation = { id: conversationId, evidence_node_id: deterministicUuid("conversation"), conversation_key: "fixture:1", primary_source_item_id: sourceId, canonical_url: source.canonical_url, author_external_id: null, author_display_name: null, author_profile_url: null, title: source.title, body: source.body, published_at: source.published_at, last_activity_at: source.published_at, captured_at: source.captured_at, language: "en", metadata: {}, content_hash: source.content_hash, canonicalization_version: "canonical-v1", created_at: source.created_at, updated_at: source.updated_at } as ConversationRow;
    const analysis = { id: deterministicUuid("analysis"), conversation_id: conversationId, evidence_node_id: deterministicUuid("analysis-evidence"), engine_version_id: deterministicUuid("analysis-engine"), input_fingerprint: sha256Text("analysis"), intent_type: "high_intent", pain_themes: ["manual reporting"], desired_outcomes: ["faster reporting"], alternatives: [], buyer_language: ["I need a tool"], audience_signals: [], specificity: 0.8, urgency: null, confidence: 0.9, status: "completed", skip_reason: null, evidence_spans: [], provider: "fixture", model: "deterministic", prompt_version: "fixture-v1", usage_metadata: {}, created_at: "2026-09-19T00:00:00.000Z" } as ConversationAnalysisRow;
    const evaluation = { id: evaluationId, workspace_id: workspaceId, product_match_id: deterministicUuid("match"), product_id: productId, conversation_id: conversationId, demand_profile_id: profileId, conversation_analysis_id: analysis.id, match_engine_version_id: deterministicUuid("match-engine"), evidence_node_id: deterministicUuid("evaluation-evidence"), input_fingerprint: sha256Text("evaluation"), match_confidence: 0.85, rationale: "Strong fit", evidence: { capabilityAlignment: ["automation"] }, decision: "qualified", created_at: "2026-09-19T00:00:00.000Z" } as ProductMatchEvaluationRow;
    intelligence.sourceItems.set(source.id, source); intelligence.conversations.set(conversation.id, conversation); intelligence.analyses.set(analysis.id, analysis); intelligence.evaluations.set(evaluation.id, evaluation);
    const service = new DemandIntelligenceService(repository, intelligence);
    const observations = await service.materializeObservations(product, evaluation.id, deterministicUuid("observation-engine"));
    expect(observations.map((item) => item.observation_type)).toEqual(expect.arrayContaining(["pain", "desired_outcome", "buyer_language", "intent", "capability_request"]));
    expect(repository.provenance.some((edge) => edge.relationType === "derived_from_source_item")).toBe(true);
    expect(await service.materializeObservations(product, evaluation.id, deterministicUuid("observation-engine"))).toHaveLength(observations.length);
  });

  it("aggregates 30-day demand, calculates a positioning gap, and detects rising drift", async () => {
    const repository = new InMemoryDemandRepository();
    const intelligence = new InMemoryIntelligenceRepository();
    const service = new DemandIntelligenceService(repository, intelligence);
    for (let index = 0; index < 6; index++) await seedObservation(repository, { id: deterministicUuid(`old:${index}`), value: index < 3 ? "manual workflow" : "crm fragmentation", date: "2026-08-10T00:00:00.000Z", conversation: deterministicUuid(`old-conversation:${index}`) });
    for (let index = 0; index < 8; index++) await seedObservation(repository, { id: deterministicUuid(`new:${index}`), value: "manual workflow", date: "2026-09-10T00:00:00.000Z", conversation: deterministicUuid(`new-conversation:${index}`) });
    const themes = await service.materializeThemes(product, profile, deterministicUuid("theme-engine"), new FixtureDemandThemeEngine());
    expect(themes.map((item) => item.theme_key)).toEqual(expect.arrayContaining(["manual_workflow_pain", "crm_fragmentation"]));
    const previous = await service.aggregateDemand({ product, profile, window: "30d", periodEnd: "2026-08-20T00:00:00.000Z", mapEngineVersionId: deterministicUuid("map-engine") , themeEngineVersionId: deterministicUuid("theme-engine") });
    const current = await service.aggregateDemand({ product, profile, window: "30d", periodEnd: "2026-09-20T00:00:00.000Z", mapEngineVersionId: deterministicUuid("map-engine"), themeEngineVersionId: deterministicUuid("theme-engine") });
    expect(current.sample_size).toBe(8);
    expect(current.measurement_quality).toBe("low_confidence");
    const gap = await service.calculateDemandGap(product, productSnapshot, current, deterministicUuid("gap-engine"));
    expect(gap.find((item) => item.concept_key === "manual_workflow_pain")?.gap_score).toBeGreaterThan(0);
    const drift = await service.calculateDemandDrift(current, previous, deterministicUuid("drift-engine"));
    expect(drift.find((item) => item.concept_key === "manual_workflow_pain")?.drift_direction).toBe("rising");
    expect(drift.find((item) => item.concept_key === "manual_workflow_pain")?.significance).toBe("strong");
    expect((await service.getDemandMap(workspaceId, productId, "30d")).themes.length).toBeGreaterThan(0);
    expect(repository.provenance.some((edge) => edge.relationType === "compares_demand_snapshot")).toBe(true);
  });
});
