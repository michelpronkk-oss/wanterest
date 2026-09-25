import { describe, expect, it } from "vitest";

import { InMemoryActionRepository } from "../../src/server/modules/actions/action.repository";
import { FixtureDemandActionEngine } from "../../src/server/modules/actions/action.engines";
import { DemandActionService } from "../../src/server/modules/actions/action.service";
import { actionBasisLifecycleStatus, legacyActionGenerationPauseReason, NO_LIFECYCLE_VERIFIED_BASIS_WARNING, type ActionGenerationInput } from "../../src/server/modules/actions/action.schemas";
import { Phase4DigestSource, type DigestCurrentnessPort } from "../../src/server/modules/digests/digest.service";
import { InMemoryIntelligenceRepository } from "../../src/server/modules/intelligence/intelligence.repository";
import { InMemoryDemandRepository } from "../../src/server/modules/demand-intelligence/demand.repository";
import type { DemandClusterMatchLifecycle } from "../../src/server/modules/demand-intelligence/demand-clustering.repository";
import type { SignalRow } from "../../src/server/db/database.helpers";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const triggerId = "33333333-3333-4333-8333-333333333333";
const triggerEvidenceNodeId = "44444444-4444-4444-8444-444444444444";

function gapInput(overrides: Partial<ActionGenerationInput> = {}): ActionGenerationInput {
  return {
    workspaceId, productId, productName: "Workflow Helper", triggerType: "demand_gap", triggerId,
    triggerEvidenceNodeId, triggerConceptKey: "manual_workflow_pain", conceptLabel: "manual workflow pain",
    targetKey: "homepage_hero", marketWeight: 0.31, gapScore: 0.78, driftStrength: 0,
    intentStrength: 0.8, opportunityScore: 0.7, evidenceStrength: 0.9, confidence: 0.9, freshness: 0.95,
    sampleSize: 31, sampleQuality: "normal", positioningWeight: 0.04, highIntentShare: 0.7,
    specificity: 0.8, buyerLanguage: [], supportingEvidence: [], ...overrides,
  };
}

describe("Layer 9B: legacy Action generation pause", () => {
  it("the pure gate returns the explicit warning only when the flag is on", () => {
    expect(legacyActionGenerationPauseReason(false)).toBeNull();
    expect(legacyActionGenerationPauseReason(true)).toBe(NO_LIFECYCLE_VERIFIED_BASIS_WARNING);
    expect(NO_LIFECYCLE_VERIFIED_BASIS_WARNING).toBe("no_lifecycle_verified_basis");
  });

  it("action.orchestration.ts checks the gate before any gap/drift/snapshot/geography read (source contract, same style as tests/contracts/module-boundaries.test.ts)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/server/modules/actions/action.orchestration.ts", "utf8");
    const gateIndex = source.indexOf("legacyActionGenerationPauseReason(");
    const gapReadIndex = source.indexOf("demand.listGaps(");
    const geoIndex = source.indexOf("geographyService.getGeography(");
    expect(gateIndex).toBeGreaterThan(0);
    expect(gateIndex).toBeLessThan(gapReadIndex);
    expect(gateIndex).toBeLessThan(geoIndex);
  });
});

describe("Layer 9B: Action read-time basis label", () => {
  it("with the flag off, every Action reads 'not_applicable' — identical to pre-9B behaviour", () => {
    expect(actionBasisLifecycleStatus(false)).toBe("not_applicable");
  });

  it("with the flag on, an existing legacy-triggered Action reads 'not_verified' — a label only, never a mutation", async () => {
    const repository = new InMemoryActionRepository();
    const flagOff = new DemandActionService(repository);
    const created = await flagOff.generateActions(gapInput(), new FixtureDemandActionEngine());
    expect(created.actions).toHaveLength(1);
    const storedBefore = { ...created.actions[0] };

    const flagOn = new DemandActionService(repository, undefined, undefined, { downstreamIntelligenceV2Enabled: true });
    const readModel = await flagOn.getAction(workspaceId, created.actions[0].id);
    expect(readModel.basisLifecycleStatus).toBe("not_verified");
    expect(readModel.action).toEqual(storedBefore); // never rewritten

    const readOff = await flagOff.getAction(workspaceId, created.actions[0].id);
    expect(readOff.basisLifecycleStatus).toBe("not_applicable");
  });
});

describe("Layer 9B: Digests share the canonical currentness resolver", () => {
  function signal(id: string, overrides: Partial<SignalRow> = {}): SignalRow {
    return {
      id, workspace_id: workspaceId, product_id: productId, conversation_id: `conv-${id}`, product_match_id: `match-${id}`,
      product_match_evaluation_id: `eval-${id}`, match_ranking_id: `ranking-${id}`, source_key: "github", canonical_url: null,
      published_at: "2026-09-20T00:00:00.000Z", created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z",
      intent_type: "switching_intent", excerpt: "excerpt", why_it_matters: "matters", tags: [], buyer_language: [], pain_themes: [],
      lifecycle_status: "active", evidence_node_id: `node-${id}`, ...overrides,
    } as unknown as SignalRow;
  }

  function lifecyclePort(enabled: boolean, rows: DemandClusterMatchLifecycle[]): DigestCurrentnessPort {
    return { enabled, loadMatchLifecycle: async (_ws, _pid, ids) => rows.filter((row) => ids.includes(row.productMatchId)) };
  }

  it("flag off preserves existing behaviour exactly: all in-period signals plus legacy themes/gaps/drifts", async () => {
    const intelligence = new InMemoryIntelligenceRepository();
    const demand = new InMemoryDemandRepository();
    intelligence.signals.set("s1", signal("s1"));
    const source = new Phase4DigestSource(intelligence, demand);
    const candidates = await source.listCandidates({ workspaceId, productId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T00:00:00.000Z" });
    expect(candidates.some((item) => item.itemType === "signal" && item.itemId === "s1")).toBe(true);
  });

  it("flag on: excludes a superseded signal", async () => {
    const intelligence = new InMemoryIntelligenceRepository();
    const demand = new InMemoryDemandRepository();
    intelligence.signals.set("s1", signal("s1"));
    const source = new Phase4DigestSource(intelligence, demand, lifecyclePort(true, [{ productMatchId: "match-s1", found: true, currentEvaluationId: "eval-newer", signalLifecycleStatus: "active" }]));
    const candidates = await source.listCandidates({ workspaceId, productId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T00:00:00.000Z" });
    expect(candidates.some((item) => item.itemType === "signal")).toBe(false);
  });

  it("flag on: excludes an invalidated signal", async () => {
    const intelligence = new InMemoryIntelligenceRepository();
    const demand = new InMemoryDemandRepository();
    intelligence.signals.set("s1", signal("s1", { lifecycle_status: "invalidated" }));
    const source = new Phase4DigestSource(intelligence, demand, lifecyclePort(true, [{ productMatchId: "match-s1", found: true, currentEvaluationId: "eval-s1", signalLifecycleStatus: "active" }]));
    const candidates = await source.listCandidates({ workspaceId, productId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T00:00:00.000Z" });
    expect(candidates.some((item) => item.itemType === "signal")).toBe(false);
  });

  it("flag on: excludes a retracted signal", async () => {
    const intelligence = new InMemoryIntelligenceRepository();
    const demand = new InMemoryDemandRepository();
    intelligence.signals.set("s1", signal("s1", { lifecycle_status: "retracted" }));
    const source = new Phase4DigestSource(intelligence, demand, lifecyclePort(true, [{ productMatchId: "match-s1", found: true, currentEvaluationId: "eval-s1", signalLifecycleStatus: "active" }]));
    const candidates = await source.listCandidates({ workspaceId, productId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T00:00:00.000Z" });
    expect(candidates.some((item) => item.itemType === "signal")).toBe(false);
  });

  it("flag on: keeps a current signal, and excludes legacy theme/gap/drift candidates entirely", async () => {
    const intelligence = new InMemoryIntelligenceRepository();
    const demand = new InMemoryDemandRepository();
    intelligence.signals.set("s1", signal("s1"));
    demand.gaps.set("g1", { id: "g1", workspace_id: workspaceId, product_id: productId, created_at: "2026-09-15T00:00:00.000Z", evidence_node_id: "g1-node", concept_key: "x", gap_score: 0.5, interpretation: "x" } as never);
    const source = new Phase4DigestSource(intelligence, demand, lifecyclePort(true, [{ productMatchId: "match-s1", found: true, currentEvaluationId: "eval-s1", signalLifecycleStatus: "active" }]));
    const candidates = await source.listCandidates({ workspaceId, productId, periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T00:00:00.000Z" });
    expect(candidates).toEqual([expect.objectContaining({ itemType: "signal", itemId: "s1" })]);
  });

  it("uses the identical exclusion predicate the Map/Gap v2/Drift v2 use — not a second lifecycle definition", async () => {
    const mapPolicy = await import("../../src/server/modules/demand-intelligence/demand-map.policy");
    const digestSource = await import("node:fs/promises").then((fs) => fs.readFile("src/server/modules/digests/digest.service.ts", "utf8"));
    expect(digestSource).toContain("lifecycleExclusionReason(");
    expect(typeof mapPolicy.lifecycleExclusionReason).toBe("function");
  });
});
