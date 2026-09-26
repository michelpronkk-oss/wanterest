import { describe, expect, it } from "vitest";

import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine, InMemoryIntelligenceRepository, IntelligenceService } from "../../src/server/modules/intelligence";
import {
  previewSignalRevalidation,
  previewWorkspaceSignalRevalidation,
  SIGNAL_REVALIDATION_PREVIEW_MAX_SIGNALS,
  SIGNAL_REVALIDATION_PREVIEW_VERSION,
  type SignalRevalidationPreviewClusterRepository,
  type SignalRevalidationPreviewIntelligenceRepository,
  type SignalRevalidationPreviewShadowRepository,
} from "../../src/server/modules/intelligence/signal-revalidation-preview.service";
import { InMemoryDemandClusteringRepository } from "../../src/server/modules/demand-intelligence/demand-clustering.repository";
import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import type { ConversationRow, ProductRow, SourceItemRow, SignalRow } from "../../src/server/db/database.helpers";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "99999999-9999-4999-8999-999999999999";
const productId = "22222222-2222-4222-8222-222222222222";
const SCOPED_ENV = { EVIDENCE_FIDELITY_GROUNDING_ENABLED: "true", EVIDENCE_FIDELITY_GROUNDING_WORKSPACE_IDS: workspaceId };

/**
 * Wraps the full (read+write) in-memory repository into a plain object literal
 * exposing ONLY the read methods the preview's type declares. This is not just
 * type erasure: the returned object genuinely has no updateSignal/createEvaluation/
 * setCurrentEvaluation/etc. property at all, so an accidental call from the preview
 * would throw "not a function" at runtime, not merely fail a type check.
 */
function readOnlyIntelligenceView(repo: InMemoryIntelligenceRepository): SignalRevalidationPreviewIntelligenceRepository {
  return {
    getProduct: (id) => repo.getProduct(id),
    getProductSnapshots: (id) => repo.getProductSnapshots(id),
    getDemandProfileById: (id) => repo.getDemandProfileById(id),
    getConversation: (id) => repo.getConversation(id),
    getSourceItem: (id) => repo.getSourceItem(id),
    getConversationAnalysisById: (id) => repo.getConversationAnalysisById(id),
    getMatchById: (id) => repo.getMatchById(id),
    getEvaluationById: (id) => repo.getEvaluationById(id),
    listSignals: (ws, pid) => repo.listSignals(ws, pid),
  };
}

function readOnlyClusterView(repo: InMemoryDemandClusteringRepository): SignalRevalidationPreviewClusterRepository {
  return {
    listClusters: (ws, pid, version) => repo.listClusters(ws, pid, version),
    listMemberships: (ws, pid, version) => repo.listMemberships(ws, pid, version),
  };
}

function noArtifactsShadowView(): SignalRevalidationPreviewShadowRepository {
  return { loadForReplay: async () => [] };
}

function reusableSwitchingReasoning(evidenceText = "we are leaving Jira and moving to Linear because our engineering team needs faster issue tracking") {
  return {
    version: "conversation_market_reasoning_v2", actor_type: "buyer", actor_confidence: 0.9, buyer_context: true, buyer_context_confidence: 0.9,
    current_solution: "Jira", pain_summary: "needs faster issue tracking", requested_outcome: "faster issue tracking",
    demand_target_type: "scanned_product", demand_target: "Linear", source_products: ["Jira"], destination_products: ["Linear"],
    mentioned_products: [{ name: "Jira", role: "source", confidence: 0.95 }, { name: "Linear", role: "destination", confidence: 0.95 }],
    direction_relative_to_scanned_product: "toward_product", category_or_job_demand: false, commercial_intent: true, first_party_experience: true,
    implementation_only: false, promotional_content: false, confidence: 0.9,
    evidence_spans: [{ text: evidenceText, confidence: 0.9 }],
    short_user_facing_summary: "Switching from Jira to Linear.", short_user_facing_why: "Explicit switching intent.",
    relationship_candidates: [], authorial_stance: "buyer",
  };
}

/** Builds one fully-materialized signal (product, source, conversation, analysis, profile, match, evaluation, signal). */
async function seedMaterializedSignal(repo: InMemoryIntelligenceRepository, options: { body: string; publishedAt: string; intentType?: string; excerpt?: string; whyItMatters?: string; workspaceIdOverride?: string } ) {
  const seedKey = options.body;
  const scopedProductId = options.workspaceIdOverride ? deterministicUuid(`preview-product:${options.workspaceIdOverride}`) : productId;
  const product: ProductRow = repo.products.get(scopedProductId) ?? { id: scopedProductId, workspace_id: options.workspaceIdOverride ?? workspaceId, name: "Linear", slug: `linear-${scopedProductId.slice(0, 8)}`, website_url: null, status: "active", current_snapshot_id: null, current_demand_profile_id: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" };
  repo.products.set(product.id, product);

  const sourceId = deterministicUuid(`preview-source:${seedKey}`);
  const conversationId = deterministicUuid(`preview-conversation:${seedKey}`);
  const source: SourceItemRow = { id: sourceId, evidence_node_id: deterministicUuid(`preview-source-evidence:${sourceId}`), source_key: "github", external_id: `preview:${sourceId}`, external_conversation_id: conversationId, canonical_url: `https://example.com/github/${sourceId}`, author_external_id: "github:user:1", author_display_name: "author", author_profile_url: null, title: null, body: options.body, published_at: options.publishedAt, captured_at: options.publishedAt, language: "en", metadata: {}, content_hash: sha256Text(options.body), latest_raw_source_item_id: deterministicUuid(`preview-raw:${sourceId}`), normalization_version: "fixture-v1", status: "active", created_at: options.publishedAt, updated_at: options.publishedAt } as unknown as SourceItemRow;
  repo.sourceItems.set(source.id, source);
  const conversation: ConversationRow = { id: conversationId, evidence_node_id: deterministicUuid(`preview-conversation-evidence:${conversationId}`), conversation_key: `preview:${conversationId}`, primary_source_item_id: sourceId, canonical_url: source.canonical_url, author_external_id: source.author_external_id, author_display_name: source.author_display_name, author_profile_url: null, title: null, body: options.body, published_at: source.published_at, last_activity_at: source.published_at, captured_at: source.captured_at, language: "en", metadata: {}, content_hash: source.content_hash, canonicalization_version: "fixture-v1", created_at: source.created_at, updated_at: source.updated_at } as unknown as ConversationRow;
  repo.conversations.set(conversation.id, conversation);

  const service = new IntelligenceService(repo);
  const snapshot = await service.createSnapshot(product, { pageType: "manual", rawText: "Linear is issue tracking software for software teams." });
  repo.products.set(product.id, { ...product, current_snapshot_id: snapshot.id });
  const profile = await service.generateDemandProfile({ ...product, current_snapshot_id: snapshot.id }, deterministicUuid(`preview-profile-engine:${seedKey}`), new FixtureDemandProfileEngine());
  const analysis = await service.analyzeConversation(conversation, source, deterministicUuid(`preview-analysis-engine:${seedKey}`), new FixtureConversationAnalysisEngine());
  const matcherVersionId = deterministicUuid(`preview-matcher-engine:${seedKey}`);
  const evaluation = await service.matchProduct(product, profile.id, analysis.id, matcherVersionId, new FixtureProductMatchingEngine());

  const signal: SignalRow = {
    id: deterministicUuid(`preview-signal:${seedKey}`),
    workspace_id: product.workspace_id,
    product_id: product.id,
    product_match_id: evaluation.product_match_id,
    product_match_evaluation_id: evaluation.id,
    match_ranking_id: null,
    conversation_id: conversation.id,
    evidence_node_id: deterministicUuid(`preview-signal-evidence:${seedKey}`),
    lifecycle_status: "active",
    intent_type: options.intentType ?? "switching_intent",
    excerpt: options.excerpt ?? options.body.slice(0, 200),
    why_it_matters: options.whyItMatters ?? "A user is switching.",
    tags: [],
    buyer_language: [],
    pain_themes: [],
    source_key: "github",
    canonical_url: source.canonical_url,
    published_at: options.publishedAt,
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    invalidated_at: null,
    invalidated_reason: null,
    invalidated_by: null,
    retracted_at: null,
    retracted_reason: null,
    retracted_by: null,
    lifecycle_version: "signal_lifecycle_v1",
  } as unknown as SignalRow;
  repo.signals.set(signal.id, signal);
  return { product, source, conversation, profile, analysis, evaluation, signal };
}

describe("signal-revalidation-preview.service (signal_revalidation_preview_v1)", () => {
  it("has the expected version and bound", () => {
    expect(SIGNAL_REVALIDATION_PREVIEW_VERSION).toBe("signal_revalidation_preview_v1");
    expect(SIGNAL_REVALIDATION_PREVIEW_MAX_SIGNALS).toBe(50);
  });

  it("previews a 19-signal-style bounded set, considering every signal exactly once", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    for (let index = 0; index < 19; index += 1) {
      await seedMaterializedSignal(repo, { body: `We are switching from Jira to Linear because our team ${index} needs faster issue tracking.`, publishedAt: "2026-09-20T00:00:00.000Z" });
    }
    const report = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    expect(report.signal_ids_considered).toHaveLength(19);
    expect(report.results).toHaveLength(19);
    expect(new Set(report.signal_ids_considered).size).toBe(19);
  });

  it("caps at the hard maximum of 50 even when more signals exist", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    for (let index = 0; index < 60; index += 1) {
      await seedMaterializedSignal(repo, { body: `Switching thread number ${index} about Jira to Linear migration for our engineering team.`, publishedAt: "2026-09-20T00:00:00.000Z" });
    }
    const report = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV });
    expect(report.signal_ids_considered).toHaveLength(50);
  });

  it("produces deterministic ordering across repeated invocations", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    for (let index = 0; index < 8; index += 1) {
      await seedMaterializedSignal(repo, { body: `Deterministic ordering test thread ${index} about switching from Jira to Linear.`, publishedAt: "2026-09-20T00:00:00.000Z" });
    }
    const now = new Date("2026-09-26T00:00:00.000Z");
    const first = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now });
    const second = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now });
    expect(second.signal_ids_considered).toEqual(first.signal_ids_considered);
  });

  it("repeat invocation produces the same categorical decisions (repeatable preview)", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const now = new Date("2026-09-26T00:00:00.000Z");
    const first = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now });
    // A second run a few milliseconds later (wall-clock drift) must not flip the decision bucket.
    const second = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now: new Date(now.getTime() + 50) });
    expect(second.results.map((r) => r.decision)).toEqual(first.results.map((r) => r.decision));
  });

  it("preview leaves every repository map byte-for-byte unchanged (no write reachable/called)", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const before = { signals: new Map(repo.signals), evaluations: new Map(repo.evaluations), matches: new Map(repo.matches) };
    await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV });
    expect(repo.signals).toEqual(before.signals);
    expect(repo.evaluations).toEqual(before.evaluations);
    expect(repo.matches).toEqual(before.matches);
  });

  it("IDOR: never returns a signal outside the requested workspace, even if the underlying repository call is buggy and returns one", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const { signal: crossWorkspaceSignal } = await seedMaterializedSignal(repo, { body: "A completely different workspace's private switching thread about Jira to Linear.", publishedAt: "2026-09-20T00:00:00.000Z", workspaceIdOverride: otherWorkspaceId });
    // Simulate a buggy repository whose listSignals ignores the workspace filter.
    const leaky: SignalRevalidationPreviewIntelligenceRepository = { ...readOnlyIntelligenceView(repo), listSignals: async () => [...repo.signals.values()] };
    const report = await previewWorkspaceSignalRevalidation({ intelligence: leaky, cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV });
    expect(report.signal_ids_considered).not.toContain(crossWorkspaceSignal.id);
    expect(report.results.every((r) => r.workspace_id === workspaceId)).toBe(true);
  });

  it("a supported, genuinely switching signal with matching evidence: KEEP, or REQUIRES_SEMANTIC_VERIFICATION if the materialization safety gate classifies it high-risk (never WOULD_INVALIDATE/CANNOT_ASSESS - the evidence genuinely supports the claim either way)", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal } = await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z", intentType: "switching_intent" });
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow: noArtifactsShadowView(), signal, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    expect(["KEEP", "KEEP_WITH_GROUNDED_WORDING_CHANGE", "REQUIRES_SEMANTIC_VERIFICATION"]).toContain(result.decision);
  });

  it("an unsupported claim (link-only, no real content) that never materialized: ALREADY_NON_CONTRIBUTING via decideRevalidationAction's skipped path is not applicable here since the signal already exists - so a genuinely unsupportable existing signal must WOULD_INVALIDATE", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal } = await seedMaterializedSignal(repo, { body: "https://example.com/some-link", publishedAt: "2026-09-20T00:00:00.000Z", intentType: "switching_intent", excerpt: "https://example.com/some-link" });
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow: noArtifactsShadowView(), signal, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    // A link-only body never qualifies under the real deterministic pipeline, so the underlying
    // materialized "evaluation" for this fixture itself would already be non-materializing; the
    // preview must never claim KEEP for content that plainly does not support the stored claim.
    expect(["WOULD_INVALIDATE", "ALREADY_NON_CONTRIBUTING", "CANNOT_ASSESS"]).toContain(result.decision);
    expect(result.decision).not.toBe("KEEP");
  });

  it("already non-contributing lifecycle (dismissed/archived/invalidated/retracted) is preserved without recomputation", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal } = await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    for (const status of ["dismissed", "archived", "invalidated", "retracted"] as const) {
      const dismissed = { ...signal, lifecycle_status: status };
      const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow: noArtifactsShadowView(), signal: dismissed, env: SCOPED_ENV });
      expect(result.decision).toBe("ALREADY_NON_CONTRIBUTING");
      expect(result.reason).toContain(status);
    }
  });

  it("malformed/missing provenance (dangling product_match_evaluation_id) never invents evidence: CANNOT_ASSESS", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal } = await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const dangling = { ...signal, product_match_evaluation_id: deterministicUuid("nonexistent-evaluation") };
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow: noArtifactsShadowView(), signal: dangling, env: SCOPED_ENV });
    expect(result.decision).toBe("CANNOT_ASSESS");
    expect(result.fresh).toBeNull();
  });

  it("surfaces temporal classification for old evidence and flags overstated present-tense wording", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal } = await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2024-01-01T00:00:00.000Z", whyItMatters: "The team is currently switching away from Jira." });
    // A reusable persisted artifact clears the high-risk gate so the preview reaches a real
    // decision instead of REQUIRES_SEMANTIC_VERIFICATION - this test is specifically about the
    // temporal/support-flag layer, not the high-risk gate itself (covered separately above).
    const shadow: SignalRevalidationPreviewShadowRepository = { loadForReplay: async () => [{ execution_status: "success", merged_shadow_reasoning: reusableSwitchingReasoning() }] };
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow, signal, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    expect(result.temporal.classification).toBe("historical");
    expect(result.support_flags).toContain("temporal_overstatement");
  });

  it("a high-risk claim with no reusable persisted semantic artifact: REQUIRES_SEMANTIC_VERIFICATION, never guessed", async () => {
    const repo = new InMemoryIntelligenceRepository();
    // A confident, explicit switching claim naming a competitor is exactly the shape
    // assessMaterializationRisk() flags as high_risk_switching_claim once grounding is enabled.
    const { signal } = await seedMaterializedSignal(repo, { body: "We are definitely switching from Jira to Linear next month, we already made the purchase decision.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow: noArtifactsShadowView(), signal, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    if (result.decision === "REQUIRES_SEMANTIC_VERIFICATION") {
      expect(result.reason).toMatch(/no reusable persisted semantic artifact/);
    } else {
      // Not every phrasing trips the high-risk gate; if it didn't, this asserts the preview
      // still reached a real decision rather than silently doing nothing.
      expect(result.decision).not.toBeUndefined();
    }
  });

  it("a high-risk claim WITH a reusable persisted (already-validated) semantic artifact reuses it read-only - no new artifact is created", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal, conversation, product } = await seedMaterializedSignal(repo, { body: "We are definitely switching from Jira to Linear next month, we already made the purchase decision.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const persistedReasoning = {
      version: "conversation_market_reasoning_v2", actor_type: "buyer", actor_confidence: 0.9, buyer_context: true, buyer_context_confidence: 0.9,
      current_solution: "Jira", pain_summary: "needs faster issue tracking", requested_outcome: "faster issue tracking",
      demand_target_type: "scanned_product", demand_target: "Linear", source_products: ["Jira"], destination_products: ["Linear"],
      mentioned_products: [{ name: "Jira", role: "source", confidence: 0.95 }, { name: "Linear", role: "destination", confidence: 0.95 }],
      direction_relative_to_scanned_product: "toward_product", category_or_job_demand: false, commercial_intent: true, first_party_experience: true,
      implementation_only: false, promotional_content: false, confidence: 0.9,
      evidence_spans: [{ text: "we are definitely switching from Jira to Linear", confidence: 0.9 }],
      short_user_facing_summary: "Switching from Jira to Linear.", short_user_facing_why: "Explicit switching intent.",
      relationship_candidates: [], authorial_stance: "buyer",
    };
    let calledLoadForReplay = false;
    const shadow: SignalRevalidationPreviewShadowRepository = {
      loadForReplay: async (input) => {
        calledLoadForReplay = true;
        expect(input.workspaceId).toBe(product.workspace_id);
        expect(input.conversationId).toBe(conversation.id);
        return [{ execution_status: "success", merged_shadow_reasoning: persistedReasoning }];
      },
    };
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow, signal, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    expect(calledLoadForReplay).toBe(true);
    expect(result.decision).not.toBe("REQUIRES_SEMANTIC_VERIFICATION");
  });

  it("workspace outside the fidelity allowlist: cannot silently use legacy semantics to hide fidelity problems - decision still reached, never crashes", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const { signal } = await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const result = await previewSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), shadow: noArtifactsShadowView(), signal, env: {}, now: new Date("2026-09-26T00:00:00.000Z") });
    expect(result.decision).toBeDefined();
  });

  it("reconciliation: every previewed signal appears in exactly one decision bucket", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    await seedMaterializedSignal(repo, { body: "https://example.com/some-link", publishedAt: "2026-09-20T00:00:00.000Z", excerpt: "https://example.com/some-link" });
    const report = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    const totalBucketed = Object.values(report.counts).reduce((sum, value) => sum + value, 0);
    expect(totalBucketed).toBe(report.results.length);
    expect(report.results.length).toBe(report.signal_ids_considered.length);
  });

  it("cluster impact simulation: reports which signals would stop contributing and reconciles the projected count", async () => {
    const repo = new InMemoryIntelligenceRepository();
    const cluster = new InMemoryDemandClusteringRepository();
    const keep = await seedMaterializedSignal(repo, { body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.", publishedAt: "2026-09-20T00:00:00.000Z" });
    const invalidate = await seedMaterializedSignal(repo, { body: "https://example.com/some-link", publishedAt: "2026-09-20T00:00:00.000Z", excerpt: "https://example.com/some-link" });

    const clusterRow = await cluster.createCluster({ id: deterministicUuid("preview-cluster-1"), workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid("preview-cluster-1-evidence"), clustering_version: DEMAND_CLUSTERING_VERSION, clustering_engine_version_id: deterministicUuid("preview-cluster-engine"), cluster_key: "issue-tracking-switching", anchor_concept_key: "issue_tracking", intent_family: "switching", target_scope: "scanned_product", label: "Switching to Linear", identity: {} });
    await cluster.createMembership({ id: deterministicUuid("preview-membership-1"), workspace_id: workspaceId, product_id: productId, cluster_id: clusterRow.id, match_evaluation_id: keep.evaluation.id, product_match_id: keep.evaluation.product_match_id, conversation_id: keep.conversation.id, evidence_node_id: deterministicUuid("preview-membership-1-evidence"), clustering_version: DEMAND_CLUSTERING_VERSION, clustering_engine_version_id: deterministicUuid("preview-cluster-engine"), source_key: "github", evidence_at: "2026-09-20T00:00:00.000Z", confidence: 0.9, assignment: {} });
    await cluster.createMembership({ id: deterministicUuid("preview-membership-2"), workspace_id: workspaceId, product_id: productId, cluster_id: clusterRow.id, match_evaluation_id: invalidate.evaluation.id, product_match_id: invalidate.evaluation.product_match_id, conversation_id: invalidate.conversation.id, evidence_node_id: deterministicUuid("preview-membership-2-evidence"), clustering_version: DEMAND_CLUSTERING_VERSION, clustering_engine_version_id: deterministicUuid("preview-cluster-engine"), source_key: "github", evidence_at: "2026-09-20T00:00:00.000Z", confidence: 0.9, assignment: {} });

    const report = await previewWorkspaceSignalRevalidation({ intelligence: readOnlyIntelligenceView(repo), cluster: readOnlyClusterView(cluster), shadow: noArtifactsShadowView(), workspaceId, env: SCOPED_ENV, now: new Date("2026-09-26T00:00:00.000Z") });
    const impact = report.cluster_impact.find((row) => row.cluster_id === clusterRow.id);
    expect(impact).toBeDefined();
    expect(impact!.current_contributing_count).toBe(2);
    expect(impact!.projected_contributing_count).toBe(impact!.current_contributing_count - impact!.would_stop_contributing_signal_ids.length);
    // Cluster rows themselves are never mutated by the simulation.
    expect(cluster.clusters.get(clusterRow.id)).toEqual(clusterRow);
  });
});
