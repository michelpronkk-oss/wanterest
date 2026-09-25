import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { legacyActionGenerationPauseReason } from "../../src/server/modules/actions/action.schemas";
import { MAX_NEW_CONCEPT_ACTIONS_PER_PASS } from "../../src/server/modules/actions/concept-action.service";
import { AppError } from "../../src/server/lib/errors";
import { Harness, NOW, productRow, RISING_NOTABLE, RISING_STRONG, snapshot, USER, WS } from "./concept-action.harness";

const GAP_DIRECTIONAL = { status: "directional", score: null } as const;
const NEUTRAL = { direction: "stable", significance: "weak" } as const;

let extra = 0;
async function advance(h: Harness, anchor: string, opts: { gap?: Parameters<Harness["gap"]>[1] | null; drift?: Partial<Record<"7d" | "30d" | "90d", Parameters<Harness["drift"]>[2]>>; evidence?: number } = {}) {
  // A new rebuild after lifecycle change: new market state (new member set), then fully linked derived state.
  const members = [...h.live.get(anchor)!.clusters[0].members.map((m) => m.membershipId), `${anchor}-extra-${(extra += 1)}`];
  const market = await h.market(anchor, { members, evidence: opts.evidence ?? members.length });
  if (opts.gap !== null) await h.gap(market, opts.gap ?? {});
  for (const window of ["7d", "30d", "90d"] as const) await h.drift(market, window, opts.drift?.[window] ?? NEUTRAL);
  return market;
}

describe("Layer 10 concept Action pass — creation, idempotency, provenance", () => {
  it("creates one proposal with canonical identity, provenance and exactly-once usage; a replay writes nothing new", async () => {
    const h = new Harness();
    await h.concept("pricing");
    const first = await h.run();
    expect(first.actionsCreated).toBe(1);
    const [action] = h.openActions();
    expect(action).toMatchObject({ status: "proposed", trigger_type: "concept_gap", trigger_concept_key: "pricing", trigger_clustering_version: DEMAND_CLUSTERING_VERSION });
    expect(action.proposal_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(h.actions.provenance.filter((edge) => edge.derivedEvidenceNodeId === action.evidence_node_id && edge.relationType === "triggered_by")).toHaveLength(1);
    expect(h.actions.consumedUsage.size).toBe(1);
    expect(h.actions.evidenceNodes.has(action.evidence_node_id)).toBe(true);

    const second = await h.run();
    expect(second.actionsCreated).toBe(0);
    expect(second.attempts).toContainEqual(expect.objectContaining({ conceptKey: "pricing", outcome: "carried_forward", actionId: action.id }));
    expect(h.actions.actions.size).toBe(1);
    expect(h.actions.consumedUsage.size).toBe(1);
    expect([...h.actions.events.values()].filter((event) => event.event_type === "revalidated")).toHaveLength(0); // same basis row: nothing to record
  });

  it("pending selection never writes (no expiry, no supersession, no creation)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    const before = JSON.stringify([...h.actions.actions.values()]);
    h.live.set("pricing", { ...h.live.get("pricing")!, clusters: [{ ...h.live.get("pricing")!.clusters[0], members: [] }] });
    const result = await h.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "pending", reason: "currentness" }));
    expect(JSON.stringify([...h.actions.actions.values()])).toBe(before);
  });
});

describe("Layer 10 continuity Cases A / B / C", () => {
  it("Case A: settled with no candidate expires proposed and approved Actions (stale_at set), never in_progress", async () => {
    for (const status of ["proposed", "approved"] as const) {
      const h = new Harness();
      await h.concept("pricing");
      await h.run();
      const [action] = h.openActions();
      if (status === "approved") await h.lifecycle().transition(h.access(action.id), { toStatus: "approved" });
      await advance(h, "pricing", { gap: GAP_DIRECTIONAL });
      const result = await h.run();
      expect(result.actionsExpired).toBe(1);
      const expired = h.actions.actions.get(action.id)!;
      expect(expired.status).toBe("expired");
      expect(expired.stale_at).not.toBeNull();
      expect(expired.superseded_by_action_id).toBeNull();
      expect([...h.actions.events.values()].find((event) => event.action_id === action.id && event.event_type === "expired")).toMatchObject({ actor_kind: "system", from_status: status });
    }

    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    const [action] = h.openActions();
    await h.lifecycle().transition(h.access(action.id), { toStatus: "approved" });
    await h.lifecycle().transition(h.access(action.id), { toStatus: "in_progress" });
    await advance(h, "pricing", { gap: GAP_DIRECTIONAL });
    const result = await h.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "unchanged", reason: "in_progress_basis_invalid" }));
    expect(h.actions.actions.get(action.id)!.status).toBe("in_progress");
  });

  it("Case B (Gap → Gap, same semantic proposal): carry forward with revalidated_by provenance and one idempotent revalidation event", async () => {
    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    const [action] = h.openActions();
    await advance(h, "pricing");
    const newGap = await h.states.latestGapState(WS, h.product.id, DEMAND_CLUSTERING_VERSION, "pricing", "concept_gap_state_v1");
    const result = await h.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "carried_forward", actionId: action.id }));
    expect(h.actions.actions.size).toBe(1);
    expect(h.actions.provenance).toContainEqual(expect.objectContaining({ derivedEvidenceNodeId: action.evidence_node_id, sourceEvidenceNodeId: newGap!.evidence_node_id, relationType: "revalidated_by" }));
    await h.run();
    const events = [...h.actions.events.values()].filter((event) => event.action_id === action.id && event.event_type === "revalidated");
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ basisStateId: newGap!.id });
  });

  it("Drift → Drift: daily drift states and a window switch with the same meaning never duplicate the Action", async () => {
    const h = new Harness();
    const { market } = await h.concept("pricing", { gap: GAP_DIRECTIONAL, drift: { "7d": RISING_STRONG } });
    await h.run();
    const [action] = h.openActions();
    for (let day = 0; day < 3; day += 1) { await h.drift(market, "7d", RISING_STRONG); await h.run(); }
    await h.drift(market, "7d", NEUTRAL);
    await h.drift(market, "30d", RISING_STRONG);
    const result = await h.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "carried_forward", actionId: action.id, window: "30d" }));
    expect(h.actions.actions.size).toBe(1);
    expect(h.actions.consumedUsage.size).toBe(1);
  });

  it("Drift → Drift with a material change (significance) supersedes atomically", async () => {
    const h = new Harness();
    const { market } = await h.concept("pricing", { gap: GAP_DIRECTIONAL, drift: { "7d": RISING_STRONG } });
    await h.run();
    const [old] = h.openActions();
    await h.drift(market, "7d", RISING_NOTABLE);
    const result = await h.run();
    expect(result.actionsSuperseded).toBe(1);
    const [replacement] = h.openActions();
    expect(replacement.id).not.toBe(old.id);
    expect(h.actions.actions.get(old.id)).toMatchObject({ status: "superseded", superseded_by_action_id: replacement.id });
  });

  it("a changed proposal on an UNCHANGED basis row (e.g. product rename) still supersedes — the creation key includes the proposal fingerprint", async () => {
    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    const [old] = h.openActions();
    h.product = { ...h.product, name: "Renamed Product" };
    const result = await h.run();
    expect(result.actionsSuperseded).toBe(1);
    const [replacement] = h.openActions();
    expect(replacement.id).not.toBe(old.id);
    expect(replacement.trigger_id).toBe(old.trigger_id);
    expect(h.actions.actions.get(old.id)).toMatchObject({ status: "superseded", superseded_by_action_id: replacement.id });
  });

  it("Drift → Gap: a newly eligible scored Gap becomes canonical and supersedes the open Drift Action", async () => {
    const h = new Harness();
    await h.concept("pricing", { gap: GAP_DIRECTIONAL, drift: { "7d": RISING_STRONG } });
    await h.run();
    const [drift] = h.openActions();
    expect(drift.trigger_type).toBe("concept_drift");
    await advance(h, "pricing", { drift: { "7d": RISING_STRONG } });
    const result = await h.run();
    expect(result.actionsSuperseded).toBe(1);
    const [gap] = h.openActions();
    expect(gap).toMatchObject({ trigger_type: "concept_gap", status: "proposed" });
    expect(h.actions.actions.get(drift.id)).toMatchObject({ status: "superseded", superseded_by_action_id: gap.id });
    expect(h.actions.provenance).toContainEqual(expect.objectContaining({ derivedEvidenceNodeId: gap.evidence_node_id, sourceEvidenceNodeId: drift.evidence_node_id, relationType: "supersedes_action" }));
    const events = [...h.actions.events.values()];
    expect(events).toContainEqual(expect.objectContaining({ action_id: drift.id, event_type: "superseded", actor_kind: "system" }));
    expect(events).toContainEqual(expect.objectContaining({ action_id: gap.id, event_type: "regenerated" }));
  });

  it("Gap → Drift: the Gap stops qualifying while a Drift is eligible → superseded (not expired)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    const [gap] = h.openActions();
    await advance(h, "pricing", { gap: GAP_DIRECTIONAL, drift: { "30d": RISING_NOTABLE } });
    await h.run();
    const [drift] = h.openActions();
    expect(drift.trigger_type).toBe("concept_drift");
    expect(h.actions.actions.get(gap.id)).toMatchObject({ status: "superseded", superseded_by_action_id: drift.id });
  });

  it("Gap → Gap with a new positioning snapshot: pending while the gap lags (no Drift fallback), then superseded", async () => {
    const h = new Harness();
    await h.concept("pricing", { drift: { "7d": RISING_STRONG } });
    await h.run();
    const [old] = h.openActions();
    h.product = productRow({ current_snapshot_id: "snap-2" } as never);
    h.actions.snapshots.set("snap-2", snapshot("snap-2", "d".repeat(64), h.product.id, h.product.workspace_id, 2));
    const pending = await h.run();
    expect(pending.attempts).toContainEqual(expect.objectContaining({ outcome: "pending", reason: "positioning" }));
    expect(h.actions.actions.get(old.id)!.status).toBe("proposed");
    const market = await h.states.latestMarketState(WS, h.product.id, DEMAND_CLUSTERING_VERSION, "pricing", "concept_market_state_v1");
    await h.gap(market!, { snapshotId: "snap-2" });
    await h.run();
    const [replacement] = h.openActions();
    expect(replacement.trigger_type).toBe("concept_gap");
    expect(h.actions.actions.get(old.id)).toMatchObject({ status: "superseded", superseded_by_action_id: replacement.id });
  });

  it("a sample-quality bucket change supersedes; in_progress is never superseded (proposalCurrent=false instead)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    const [old] = h.openActions();
    await advance(h, "pricing", { evidence: 60 }); // normal → high_confidence
    expect((await h.run()).actionsSuperseded).toBe(1);
    expect(h.actions.actions.get(old.id)!.status).toBe("superseded");

    const h2 = new Harness();
    await h2.concept("pricing");
    await h2.run();
    const [working] = h2.openActions();
    await h2.lifecycle().transition(h2.access(working.id), { toStatus: "approved" });
    await h2.lifecycle().transition(h2.access(working.id), { toStatus: "in_progress" });
    await advance(h2, "pricing", { evidence: 60 });
    const result = await h2.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "unchanged", reason: "in_progress_proposal_changed" }));
    expect(h2.openActions()).toHaveLength(1);
    const live = await h2.lifecycle().evaluate([h2.actions.actions.get(working.id)!], { canMutate: true });
    expect(live.get(working.id)).toMatchObject({ basisStatus: "valid", proposalCurrent: false, allowedTransitions: ["completed", "dismissed"] });
  });
});

describe("Layer 10 atomic create/supersede RPC semantics (in-memory emulation; real Postgres in tests/rls)", () => {
  async function request(h: Harness, id: string, key = "action:key") {
    const { gap } = await h.concept("pricing");
    return { gap, payload: { id, workspace_id: WS, product_id: h.product.id, evidence_node_id: `node-${id}`, action_type: "messaging_change", trigger_type: "concept_gap", trigger_id: gap!.id, trigger_evidence_node_id: gap!.evidence_node_id, trigger_concept_key: "pricing", trigger_clustering_version: DEMAND_CLUSTERING_VERSION, proposal_fingerprint: "a".repeat(64), target_key: "homepage_hero", title: "t", summary: "s", why: "w", suggested_change: "c", priority_score: 0.5, confidence: 0.5, action_engine_version_id: "e", priority_formula_version: "action-priority-v1", input_fingerprint: "b".repeat(64), idempotency_key: key } as never };
  }

  it("a retry with a different caller UUID resolves the stored Action by (workspace_id, idempotency_key): no orphan node, usage once", async () => {
    const h = new Harness();
    const { payload } = await request(h, "id-1");
    const first = await h.actions.createConceptAction({ action: payload });
    const retry = await h.actions.createConceptAction({ action: { ...(payload as object), id: "id-2", evidence_node_id: "node-id-2" } as never });
    expect(retry.id).toBe(first.id);
    expect(h.actions.actions.size).toBe(1);
    expect(h.actions.evidenceNodes.has("node-id-2")).toBe(false);
    expect(h.actions.consumedUsage.size).toBe(1);
  });

  it("supersession replay (lost response / new UUID) returns the same replacement; the old Action always has a resolvable replacement", async () => {
    const h = new Harness();
    const { payload } = await request(h, "old", "action:old");
    const old = await h.actions.createConceptAction({ action: payload });
    const replacementPayload = { ...(payload as object), id: "new-1", evidence_node_id: "node-new-1", idempotency_key: "action:new", proposal_fingerprint: "c".repeat(64) } as never;
    const first = await h.actions.createConceptAction({ action: replacementPayload, supersedeActionId: old.id, expectedStatus: "proposed" });
    const replay = await h.actions.createConceptAction({ action: { ...(replacementPayload as object), id: "new-2", evidence_node_id: "node-new-2" } as never, supersedeActionId: old.id, expectedStatus: "proposed" });
    expect(replay.id).toBe(first.id);
    expect(h.actions.actions.get(old.id)).toMatchObject({ status: "superseded", superseded_by_action_id: first.id });
    expect(h.actions.consumedUsage.size).toBe(2);
    expect(h.openActions()).toHaveLength(1);
  });

  it("usage refusal rolls the whole transaction back: the old Action stays open, no replacement, no node, no usage", async () => {
    const h = new Harness();
    const { payload } = await request(h, "old", "action:old");
    const old = await h.actions.createConceptAction({ action: payload });
    h.actions.usageRefusal = "USAGE_LIMIT_EXCEEDED";
    await expect(h.actions.createConceptAction({ action: { ...(payload as object), id: "new", evidence_node_id: "node-new", idempotency_key: "action:new" } as never, supersedeActionId: old.id, expectedStatus: "proposed" })).rejects.toMatchObject({ code: "USAGE_LIMIT_EXCEEDED" });
    expect(h.actions.actions.get(old.id)!.status).toBe("proposed");
    expect(h.actions.actions.has("new")).toBe(false);
    expect(h.actions.evidenceNodes.has("node-new")).toBe(false);
    expect(h.actions.consumedUsage.size).toBe(1);
  });

  it("a second open Action for the same canonical concept is rejected by the one-open slot (cross-type), with full rollback", async () => {
    const h = new Harness();
    const { payload } = await request(h, "a", "action:a");
    await h.actions.createConceptAction({ action: payload });
    await expect(h.actions.createConceptAction({ action: { ...(payload as object), id: "b", evidence_node_id: "node-b", idempotency_key: "action:b", trigger_type: "concept_drift" } as never })).rejects.toMatchObject({ details: { reason: "open_concept_action_exists" } });
    expect(h.actions.actions.has("b")).toBe(false);
    expect(h.actions.evidenceNodes.has("node-b")).toBe(false);
  });

  it("compare-and-set: superseding with a stale expected status conflicts and writes nothing", async () => {
    const h = new Harness();
    const { payload } = await request(h, "old", "action:old");
    const old = await h.actions.createConceptAction({ action: payload });
    await expect(h.actions.createConceptAction({ action: { ...(payload as object), id: "n", evidence_node_id: "node-n", idempotency_key: "action:n" } as never, supersedeActionId: old.id, expectedStatus: "approved" })).rejects.toBeInstanceOf(AppError);
    expect(h.actions.actions.get(old.id)!.status).toBe("proposed");
  });

  it("concurrent Action passes (Gap/Drift candidates for one concept) converge on exactly one canonical open Action", async () => {
    const h = new Harness();
    await h.concept("pricing", { drift: { "7d": RISING_STRONG } });
    await Promise.all([h.run(), h.run(), h.run()]);
    expect(h.openActions()).toHaveLength(1);
    expect(h.actions.consumedUsage.size).toBe(1);
  });
});

describe("Layer 10 re-proposal after a human close", () => {
  async function closedGap(h: Harness, to: "dismissed" | "completed") {
    await h.concept("pricing");
    await h.run();
    const [action] = h.openActions();
    if (to === "completed") {
      await h.lifecycle().transition(h.access(action.id), { toStatus: "approved" });
      await h.lifecycle().transition(h.access(action.id), { toStatus: "in_progress" });
    }
    await h.lifecycle().transition(h.access(action.id), { toStatus: to });
    return action;
  }

  it("a user dismissal or completion suppresses the same semantic proposal", async () => {
    for (const to of ["dismissed", "completed"] as const) {
      const h = new Harness();
      await closedGap(h, to);
      await advance(h, "pricing");
      const result = await h.run();
      expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "suppressed", reason: to === "dismissed" ? "dismissed_by_user" : "completed_by_user" }));
      expect(h.openActions()).toHaveLength(0);
    }
  });

  it("a changed proposal fingerprint allows a new Action", async () => {
    const h = new Harness();
    await closedGap(h, "dismissed");
    await advance(h, "pricing", { evidence: 60 });
    expect((await h.run()).actionsCreated).toBe(1);
  });

  it("a persisted non-qualifying episode break after the closed basis allows the same proposal again", async () => {
    const h = new Harness();
    await closedGap(h, "dismissed");
    await advance(h, "pricing", { gap: GAP_DIRECTIONAL });
    await advance(h, "pricing");
    // advance() adds one member each time; keep the sample bucket identical (24 → 26 stays "normal").
    expect((await h.run()).actionsCreated).toBe(1);
  });

  it("system expiry/supersession never suppress", async () => {
    const h = new Harness();
    await h.concept("pricing");
    await h.run();
    await advance(h, "pricing", { gap: GAP_DIRECTIONAL });
    await h.run(); // expired by the system
    await advance(h, "pricing");
    expect((await h.run()).actionsCreated).toBe(1);
  });

  it("episode lookup is bounded (limit 100): hitting the cap without a break is treated as no break, with a warning", async () => {
    const h = new Harness();
    const action = await closedGap(h, "dismissed");
    const market = await h.states.latestMarketState(WS, h.product.id, DEMAND_CLUSTERING_VERSION, "pricing", "concept_market_state_v1");
    for (let index = 0; index < 101; index += 1) await h.gap(market!);
    void action;
    const result = await h.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ outcome: "suppressed" }));
    expect(result.warnings.some((warning) => warning.includes("100-state cap"))).toBe(true);
  });
});

describe("Layer 10 bounds, genericity and clustering-version identity", () => {
  it(`creates at most ${MAX_NEW_CONCEPT_ACTIONS_PER_PASS} new proposals per pass, highest opportunity first; the rest are deferred to the next pass`, async () => {
    const h = new Harness();
    const concepts = ["pricing", "api_access", "reporting", "billing_exports", "sso", "audit_logs", "webhooks"];
    for (const [index, key] of concepts.entries()) await h.concept(key, { gap: { score: 0.4 + index * 0.05 } });
    const first = await h.run();
    expect(first.actionsCreated).toBe(5);
    expect(first.attempts.filter((attempt) => attempt.outcome === "deferred")).toHaveLength(2);
    expect(h.openActions().map((row) => row.trigger_concept_key).sort()).toEqual(["audit_logs", "billing_exports", "reporting", "sso", "webhooks"]);
    expect((await h.run()).actionsCreated).toBe(2);
  });

  it("the same anchor key under a different clustering version is a different concept (never blocks, never merged)", async () => {
    const h = new Harness();
    await h.concept("pricing");
    // An open Action from a retired clustering version with the same anchor key.
    h.actions.actions.set("legacy-version-action", { ...(await (async () => { await h.run(); return h.openActions()[0]; })()), id: "legacy-version-action", idempotency_key: "k-v0", trigger_clustering_version: "demand_clustering_v0" });
    expect(h.openActions()).toHaveLength(2);
    const result = await h.run();
    expect(result.attempts).toContainEqual(expect.objectContaining({ clusteringVersion: "demand_clustering_v0", outcome: "pending", reason: "clustering_version_unsupported" }));
    expect(h.actions.actions.get("legacy-version-action")!.status).toBe("proposed");
  });

  it("concepts are opaque keys — behaviour is identical across generic concepts and products", async () => {
    const results: string[] = [];
    for (const key of ["pricing", "api_access", "reporting"]) {
      const h = new Harness(productRow({ id: "c9999999-9999-4999-8999-999999999999" } as never));
      await h.concept(key, { gap: GAP_DIRECTIONAL, drift: { "30d": RISING_STRONG } });
      await h.run();
      results.push(`${h.openActions()[0].trigger_type}:${h.openActions()[0].trigger_concept_key === key}`);
    }
    expect(new Set(results)).toEqual(new Set(["concept_drift:true"]));
    const source = ["concept-action.selector.ts", "concept-action.service.ts", "concept-action.inputs.ts", "action-lifecycle.service.ts"].map((file) => readFileSync(`src/server/modules/actions/${file}`, "utf8")).join("\n");
    expect(source).not.toMatch(/linear|jira|8b7a4189|c5946172/i);
  });

  it("the pass never reads more than one live roll-up and one positioning snapshot per product", async () => {
    const h = new Harness();
    for (const key of ["pricing", "api_access", "reporting"]) await h.concept(key);
    await h.run();
    expect(h.liveReads).toBe(1);
    expect(h.positioningReads).toBe(1);
  });
});

describe("Layer 10 orchestration contract", () => {
  it("plan gating happens before any concept-basis logic — the pure gate function", () => {
    expect(legacyActionGenerationPauseReason(false)).toBeNull();
    expect(legacyActionGenerationPauseReason(true)).toBe("no_lifecycle_verified_basis");
  });

  it("the plan gate precedes the concept pass; legacy triggers are structurally unreachable once the concept path is taken", () => {
    const source = readFileSync("src/server/modules/actions/action.orchestration.ts", "utf8");
    const planGate = source.indexOf('getWorkspaceEntitlement(client, input.product.workspace_id, "actions_enabled")');
    const branchIndex = source.indexOf("return generateConceptActionsForScan(");
    const legacyGapReadIndex = source.indexOf("demand.listGaps(");
    const conceptFnIndex = source.indexOf("async function generateConceptActionsForScan(");
    expect(planGate).toBeGreaterThan(0);
    expect(planGate).toBeLessThan(branchIndex);
    expect(branchIndex).toBeLessThan(legacyGapReadIndex);
    expect(source.slice(conceptFnIndex)).not.toMatch(/actionInputFromGap\(|actionInputFromDrift\(|actionInputFromSnapshot\(|actionInputFromGeoMarket\(/);
  });

  it("generateActions refuses concept trigger types: concept Actions only come from the atomic concept pass", async () => {
    const h = new Harness();
    const { gap } = await h.concept("pricing");
    await expect(h.actionService().generateActions({ workspaceId: WS, productId: h.product.id, productName: "x", triggerType: "concept_gap", triggerId: "00000000-0000-4000-8000-000000000001", triggerEvidenceNodeId: "00000000-0000-4000-8000-000000000002", triggerConceptKey: "pricing", conceptLabel: "pricing", targetKey: "auto", confidence: 0.8, sampleQuality: "normal" } as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    void gap; void USER; void NOW;
  });
});
