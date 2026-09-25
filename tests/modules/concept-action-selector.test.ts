import { describe, expect, it } from "vitest";

import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { expectedConceptDriftStateFingerprint } from "../../src/server/modules/demand-intelligence/concept-market-state.policy";
import { staleBefore } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { identityFor, selectFromInputs } from "../../src/server/modules/actions/concept-action.inputs";
import { evaluateActionLiveBasis, type ConceptSelection } from "../../src/server/modules/actions/concept-action.selector";
import { Harness, NOW, productRow, RISING_NOTABLE, RISING_STRONG, snapshot } from "./concept-action.harness";

async function select(h: Harness, anchor: string, clusteringVersion: string = DEMAND_CLUSTERING_VERSION): Promise<ConceptSelection> {
  const inputs = await h.service().loadInputs(h.product, NOW);
  return selectFromInputs(inputs, identityFor(inputs, anchor, clusteringVersion));
}

function candidateOf(selection: ConceptSelection) {
  if (selection.state !== "settled" || !selection.candidate) throw new Error(`expected a candidate, got ${JSON.stringify(selection)}`);
  return selection.candidate;
}

describe("Layer 10 canonical concept selector — settled vs pending", () => {
  it("no market state → settled, no candidate", async () => {
    const h = new Harness();
    expect(await select(h, "pricing")).toEqual({ state: "settled", candidate: null, reason: "no_market_state" });
  });

  it("market state older than the existing 90-day rule → settled, no candidate", async () => {
    const h = new Harness();
    await h.concept("pricing", { market: { computedAt: new Date(Date.parse(staleBefore(NOW)) - 3_600_000).toISOString() } });
    expect(await select(h, "pricing")).toEqual({ state: "settled", candidate: null, reason: "market_state_stale" });
  });

  it("live currentness fingerprint differs from the persisted market state → pending(currentness)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    h.live.set("pricing", { ...h.live.get("pricing")!, clusters: [{ ...h.live.get("pricing")!.clusters[0], members: h.live.get("pricing")!.clusters[0].members.slice(1) }] });
    expect(await select(h, "pricing")).toEqual({ state: "pending", reason: "currentness" });
  });

  it("positioning exists but no gap state is linked to the latest market state → pending(gap_materialization)", async () => {
    const h = new Harness();
    const { market } = await h.concept("pricing", { gap: null });
    void market;
    expect(await select(h, "pricing")).toEqual({ state: "pending", reason: "gap_materialization" });

    const h2 = new Harness();
    const first = await h2.concept("pricing");
    const newer = await h2.market("pricing", { evidence: 25 });
    for (const window of ["7d", "30d", "90d"]) await h2.drift(newer, window);
    void first;
    expect(await select(h2, "pricing")).toEqual({ state: "pending", reason: "gap_materialization" });
  });

  it("a drift window lagging behind a newer market state (not reproducible) → pending(drift_materialization)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    const newer = await h.market("pricing", { evidence: 25 });
    await h.gap(newer);
    await h.drift(newer, "7d");
    await h.drift(newer, "30d"); // 90d still points at the old market state
    expect(await select(h, "pricing")).toEqual({ state: "pending", reason: "drift_materialization" });
  });

  it("a legitimately unchanged drift window (older lineage, reproduces from the live roll-up) is caught up, not lag", async () => {
    const h = new Harness();
    const { market: first } = await h.concept("pricing", { gap: null, drift: { "7d": { comparable: false } } });
    void first;
    const newer = await h.market("pricing", { evidence: 25 });
    await h.gap(newer);
    await h.drift(newer, "30d");
    await h.drift(newer, "90d");
    // Replace the 7d row by one whose frozen fingerprint equals what materialization computes now (monitoring null → non-comparable).
    const reproducible = expectedConceptDriftStateFingerprint({ concept: h.live.get("pricing")!, clusteringVersion: DEMAND_CLUSTERING_VERSION, window: "7d", now: NOW, monitoringStartedAt: null });
    await h.drift(first, "7d", { comparable: false, fingerprint: reproducible });
    const selection = await select(h, "pricing");
    expect(selection.state).toBe("settled");
  });

  it("gap references an older positioning snapshot than the current one → pending(positioning)", async () => {
    const h = new Harness(productRow({ current_snapshot_id: "snap-2" } as never));
    h.actions.snapshots.set("snap-2", snapshot("snap-2", "b".repeat(64), h.product.id, h.product.workspace_id, 2));
    await h.concept("pricing", { drift: { "7d": RISING_STRONG } });
    expect(await select(h, "pricing")).toEqual({ state: "pending", reason: "positioning" }); // never falls back to the eligible drift
  });

  it("an Action under a clustering version this deployment does not validate → pending(clustering_version_unsupported)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    expect(await select(h, "pricing", "demand_clustering_v0")).toEqual({ state: "pending", reason: "clustering_version_unsupported" });
  });
});

describe("Layer 10 canonical concept selector — candidate choice", () => {
  it("an eligible scored Gap wins over an eligible Drift", async () => {
    const h = new Harness();
    await h.concept("pricing", { drift: { "7d": RISING_STRONG } });
    const candidate = candidateOf(await select(h, "pricing"));
    expect(candidate.triggerType).toBe("concept_gap");
    expect(candidate.actionType).toBe("messaging_change");
    expect(candidate.basisGuard.gapStateId).toBe(candidate.basisStateId);
  });

  it("without an eligible Gap the strongest Drift is chosen: strong before notable, then shortest window", async () => {
    const h = new Harness();
    await h.concept("pricing", { gap: { status: "directional", score: null }, drift: { "7d": RISING_NOTABLE, "30d": RISING_STRONG } });
    expect(candidateOf(await select(h, "pricing")).window).toBe("30d");

    const h2 = new Harness();
    await h2.concept("api_access", { gap: { status: "directional", score: null }, drift: { "7d": RISING_STRONG, "90d": RISING_STRONG } });
    const candidate = candidateOf(await select(h2, "api_access"));
    expect(candidate.window).toBe("7d");
    expect(candidate.triggerType).toBe("concept_drift");
    expect(candidate.actionType).toBe("landing_page");
  });

  it("no positioning snapshot at all → Gap is simply ineligible, Drift may still be selected", async () => {
    const h = new Harness(productRow({ current_snapshot_id: null } as never));
    h.actions.snapshots.clear();
    await h.concept("reporting", { gap: null, drift: { "90d": RISING_NOTABLE } });
    expect(candidateOf(await select(h, "reporting")).window).toBe("90d");
  });

  it("existing thresholds only: a scored gap below 0.35 or a weak drift is not eligible → settled, no candidate", async () => {
    const h = new Harness();
    await h.concept("pricing", { gap: { score: 0.2 }, drift: { "7d": { direction: "rising", significance: "weak", shareDelta: 0.1 } } });
    expect(await select(h, "pricing")).toEqual({ state: "settled", candidate: null, reason: "no_eligible_basis" });
  });
});

describe("Layer 10 proposal continuity fingerprint (action_proposal_continuity_v1)", () => {
  it("a new daily drift state and a window switch with the same meaning keep the same fingerprint", async () => {
    const h = new Harness();
    const { market } = await h.concept("pricing", { gap: { status: "directional", score: null }, drift: { "7d": RISING_STRONG } });
    const first = candidateOf(await select(h, "pricing"));
    await h.drift(market, "7d", RISING_STRONG); // next day's state: new id, same semantics
    const daily = candidateOf(await select(h, "pricing"));
    expect(daily.basisStateId).not.toBe(first.basisStateId);
    expect(daily.proposalFingerprint).toBe(first.proposalFingerprint);
    await h.drift(market, "7d", { direction: "stable", significance: "weak" });
    await h.drift(market, "30d", RISING_STRONG);
    const switched = candidateOf(await select(h, "pricing"));
    expect(switched.window).toBe("30d");
    expect(switched.proposalFingerprint).toBe(first.proposalFingerprint);
  });

  it("significance, sample bucket, positioning snapshot and trigger type change the fingerprint", async () => {
    const h = new Harness();
    const { market } = await h.concept("pricing", { gap: { status: "directional", score: null }, drift: { "7d": RISING_STRONG } });
    const base = candidateOf(await select(h, "pricing")).proposalFingerprint;
    await h.drift(market, "7d", RISING_NOTABLE);
    expect(candidateOf(await select(h, "pricing")).proposalFingerprint).not.toBe(base);
    await h.drift(market, "7d", { ...RISING_STRONG, current: 30, previous: 25 }); // min 25 → "normal" instead of "low_confidence"
    expect(candidateOf(await select(h, "pricing")).proposalFingerprint).not.toBe(base);

    const g = new Harness();
    await g.concept("pricing");
    const gapBase = candidateOf(await select(g, "pricing")).proposalFingerprint;
    expect(gapBase).not.toBe(base); // gap vs drift never collide
    g.product = productRow({ current_snapshot_id: "snap-2" } as never);
    g.actions.snapshots.set("snap-2", snapshot("snap-2", "c".repeat(64), g.product.id, g.product.workspace_id, 2));
    const market2 = await g.market("pricing", { evidence: 24, members: [...g.live.get("pricing")!.clusters[0].members.map((m) => m.membershipId)] });
    await g.gap(market2, { snapshotId: "snap-2" });
    for (const window of ["7d", "30d", "90d"]) await g.drift(market2, window);
    expect(candidateOf(await select(g, "pricing")).proposalFingerprint).not.toBe(gapBase);
  });
});

describe("Layer 10 live basis evaluation (pure)", () => {
  const action = (status: string, fp = "f".repeat(64), trigger = "concept_drift") => ({ status, trigger_type: trigger, proposal_fingerprint: fp });
  it("maps selection to basisStatus/proposalCurrent/allowedTransitions", async () => {
    const h = new Harness();
    await h.concept("pricing");
    const selection = await select(h, "pricing");
    const fp = candidateOf(selection).proposalFingerprint;
    expect(evaluateActionLiveBasis({ action: action("proposed", fp, "concept_gap"), selection, actionsEnabled: true, downstreamIntelligenceV2Enabled: true, canMutate: true }))
      .toEqual({ basisStatus: "valid", proposalCurrent: true, pendingReason: null, allowedTransitions: ["approved", "dismissed"], executionMode: "manual" });
    // Old Drift Action while the canonical proposal is now a Gap: valid basis, not the current proposal, not approvable.
    expect(evaluateActionLiveBasis({ action: action("proposed"), selection, actionsEnabled: true, downstreamIntelligenceV2Enabled: true, canMutate: true }))
      .toMatchObject({ basisStatus: "valid", proposalCurrent: false, allowedTransitions: ["dismissed"] });
    expect(evaluateActionLiveBasis({ action: action("approved", fp, "concept_gap"), selection: { state: "pending", reason: "currentness" }, actionsEnabled: true, downstreamIntelligenceV2Enabled: true, canMutate: true }))
      .toMatchObject({ basisStatus: "update_pending", pendingReason: "currentness", allowedTransitions: ["dismissed"] });
    expect(evaluateActionLiveBasis({ action: action("in_progress", fp, "concept_gap"), selection: { state: "settled", candidate: null }, actionsEnabled: false, downstreamIntelligenceV2Enabled: true, canMutate: true }))
      .toMatchObject({ basisStatus: "invalid", allowedTransitions: ["completed", "dismissed"] });
    expect(evaluateActionLiveBasis({ action: action("proposed", fp, "concept_gap"), selection, actionsEnabled: false, downstreamIntelligenceV2Enabled: true, canMutate: true }).allowedTransitions).toEqual(["dismissed"]);
    expect(evaluateActionLiveBasis({ action: action("proposed", fp, "concept_gap"), selection, actionsEnabled: true, downstreamIntelligenceV2Enabled: true, canMutate: false }).allowedTransitions).toEqual([]);
    // Legacy Actions under v2: readable and dismissable only.
    expect(evaluateActionLiveBasis({ action: action("proposed", fp, "demand_gap"), selection: null, actionsEnabled: true, downstreamIntelligenceV2Enabled: true, canMutate: true }))
      .toMatchObject({ basisStatus: null, allowedTransitions: ["dismissed"] });
    expect(evaluateActionLiveBasis({ action: action("expired", fp, "concept_gap"), selection, actionsEnabled: true, downstreamIntelligenceV2Enabled: true, canMutate: true }).allowedTransitions).toEqual([]);
  });
});
