import { describe, expect, it, vi } from "vitest";

import {
  buildDemandMap,
  computeDemandClusterStrength,
  DEMAND_MAP_POLICY_VERSION,
  demandMapLevel,
  demandMapV2Enabled,
  loadDemandMapView,
  resolveDemandMapMember,
  staleBefore,
  type DemandClusterMemberEvidence,
  type DemandMapClusterInput,
  type DemandMapMemberInput,
} from "../../src/server/modules/demand-intelligence";
import { envSchemas } from "../../src/server/lib/env";

const now = new Date("2026-09-25T12:00:00.000Z");
const cutoff = staleBefore(now);

function cluster(id: string, anchor: string, overrides: Partial<DemandMapClusterInput> = {}): DemandMapClusterInput {
  return {
    clusterId: id,
    clusterKey: `concept:${anchor}|intent:${overrides.intentFamily ?? "pain"}|target:${overrides.targetScope ?? "market"}`,
    label: anchor,
    anchorConceptKey: anchor,
    intentFamily: "pain",
    targetScope: "market",
    evidenceNodeId: `node-${id}`,
    state: { sequence: 1, level: "single", score: 0.5, computedAt: "2026-09-24T00:00:00.000Z", evidenceNodeId: `state-${id}`, historyLength: 1 },
    ...overrides,
  };
}

function member(id: string, clusterId: string, overrides: Partial<Omit<DemandMapMemberInput, "persisted" | "live">> & { persisted?: Partial<DemandMapMemberInput["persisted"]>; live?: Partial<DemandMapMemberInput["live"]> } = {}): DemandMapMemberInput {
  const matchEvaluationId = overrides.matchEvaluationId ?? `eval-${id}`;
  return {
    membershipId: `m-${id}`,
    clusterId,
    matchEvaluationId,
    productMatchId: `match-${id}`,
    conversationId: `conv-${id}`,
    sourceKey: "github",
    evidenceAt: "2026-09-20T00:00:00.000Z",
    evidenceNodeId: `mnode-${id}`,
    ...overrides,
    persisted: { inLatestState: true, contributes: true, reason: null, ...overrides.persisted },
    live: { found: true, currentEvaluationId: matchEvaluationId, signalLifecycleStatus: "active", ...overrides.live },
  };
}

function map(clusters: DemandMapClusterInput[], members: DemandMapMemberInput[], at = now) {
  const threshold = staleBefore(at);
  return buildDemandMap({ clusters, members: members.map((item) => resolveDemandMapMember(item, threshold)), buyerLanguage: [], legacy: null, now: at, staleBefore: threshold, statesRead: clusters.length, statesTruncated: false });
}

describe("Layer 9A demand map policy: read-time member validation", () => {
  it("keeps a member that is contributing in the persisted state and still valid now", () => {
    expect(resolveDemandMapMember(member("a", "c1"), cutoff)).toMatchObject({ contributes: true, reason: null, pendingRecompute: false });
  });

  it("excludes a superseded evaluation at read time even if the persisted state still counts it", () => {
    expect(resolveDemandMapMember(member("a", "c1", { live: { currentEvaluationId: "newer" } }), cutoff)).toMatchObject({ contributes: false, reason: "evaluation_superseded", pendingRecompute: true });
  });

  it("excludes invalidated and retracted signals at read time", () => {
    expect(resolveDemandMapMember(member("a", "c1", { live: { signalLifecycleStatus: "invalidated" } }), cutoff)).toMatchObject({ contributes: false, reason: "signal_invalidated", pendingRecompute: true });
    expect(resolveDemandMapMember(member("a", "c1", { live: { signalLifecycleStatus: "retracted" } }), cutoff)).toMatchObject({ contributes: false, reason: "signal_retracted", pendingRecompute: true });
  });

  it("excludes evidence that has become stale relative to now, not to when the state was computed", () => {
    expect(resolveDemandMapMember(member("a", "c1", { evidenceAt: "2026-06-01T00:00:00.000Z" }), cutoff)).toMatchObject({ contributes: false, reason: "stale" });
  });

  it("excludes evidence whose match can no longer be found", () => {
    expect(resolveDemandMapMember(member("a", "c1", { live: { found: false, currentEvaluationId: null } }), cutoff)).toMatchObject({ contributes: false, reason: "evidence_unavailable" });
  });

  it("never revives a persisted exclusion, even when live lifecycle now looks valid", () => {
    const revived = resolveDemandMapMember(member("a", "c1", { persisted: { contributes: false, reason: "signal_invalidated" } }), cutoff);
    expect(revived).toMatchObject({ contributes: false, reason: "signal_invalidated", pendingRecompute: true });
    const duplicate = resolveDemandMapMember(member("b", "c1", { persisted: { contributes: false, reason: "duplicate_content" } }), cutoff);
    expect(duplicate).toMatchObject({ contributes: false, reason: "duplicate_content", pendingRecompute: false });
  });

  it("does not count a membership the latest state has not seen yet", () => {
    expect(resolveDemandMapMember(member("a", "c1", { persisted: { inLatestState: false, contributes: false } }), cutoff)).toMatchObject({ contributes: false, reason: "not_in_latest_state", pendingRecompute: true });
  });
});

describe("Layer 9A demand map policy: concept roll-up", () => {
  it("rolls clusters up by anchor concept, with intent family and target scope as facets", () => {
    const result = map(
      [cluster("c1", "jira", { intentFamily: "switch" }), cluster("c2", "jira", { intentFamily: "pain", targetScope: "product" }), cluster("c3", "roadmaps")],
      [member("a", "c1"), member("b", "c2", { sourceKey: "stack-exchange" }), member("c", "c3")],
    );
    expect(result.current.map((concept) => concept.conceptKey)).toEqual(["jira", "roadmaps"]);
    const [jira] = result.current;
    expect(jira).toMatchObject({ status: "current", activeEvidenceCount: 2, activeSourceCount: 2, level: "corroborated", intentFamilyMix: { pain: 1, switch: 1 }, targetScopeMix: { market: 1, product: 1 } });
    expect(jira.identity).toEqual({ clusteringVersion: "demand_clustering_v1", anchorConceptKey: "jira" });
    // Drill-down keeps every cluster, ordered by cluster key ("intent:pain" < "intent:switch").
    expect(jira.clusters.map((item) => item.clusterId)).toEqual(["c2", "c1"]);
  });

  it("is current only with at least one live contributing member; otherwise historical", () => {
    const result = map([cluster("c1", "jira"), cluster("c2", "roadmaps")], [
      member("a", "c1", { live: { signalLifecycleStatus: "invalidated" } }),
      member("b", "c2"),
    ]);
    expect(result.current.map((concept) => concept.conceptKey)).toEqual(["roadmaps"]);
    expect(result.previouslyObserved.map((concept) => concept.conceptKey)).toEqual(["jira"]);
    expect(result.previouslyObserved[0]).toMatchObject({ status: "historical", activeEvidenceCount: 0, level: null, observedEvidenceCount: 1, exclusions: { signal_invalidated: 1 } });
  });

  it("computes the source count as the union of live sources, counting each conversation once", () => {
    const result = map([cluster("c1", "jira"), cluster("c2", "jira", { intentFamily: "switch" })], [
      member("a", "c1", { sourceKey: "github" }),
      member("b", "c1", { sourceKey: "github" }),
      member("c", "c2", { sourceKey: "bluesky" }),
      member("d", "c2", { sourceKey: "x", live: { currentEvaluationId: "newer" } }),
      member("e", "c2", { sourceKey: "github", conversationId: "conv-a", matchEvaluationId: "eval-e" }),
    ]);
    const [jira] = result.current;
    expect(jira.sourceMix).toEqual({ bluesky: 1, github: 2 });
    expect(jira.activeSourceCount).toBe(2);
    expect(jira.activeEvidenceCount).toBe(3);
    expect(jira.exclusions).toEqual({ duplicate_conversation: 1, evaluation_superseded: 1 });
    expect(result.totals).toMatchObject({ currentConceptCount: 1, activeEvidenceCount: 3, activeSourceCount: 2 });
  });

  it("ranks by active evidence, then active sources, then most recent evidence, deterministically", () => {
    const clusters = [cluster("c1", "alpha"), cluster("c2", "bravo"), cluster("c3", "charlie"), cluster("c4", "delta"), cluster("c5", "echo")];
    const members = [
      member("a1", "c1"), member("a2", "c1"),
      member("b1", "c2"), member("b2", "c2", { sourceKey: "bluesky" }),
      member("c1", "c3", { evidenceAt: "2026-09-10T00:00:00.000Z" }),
      member("d1", "c4", { evidenceAt: "2026-09-22T00:00:00.000Z" }),
      member("e1", "c5", { evidenceAt: "2026-09-22T00:00:00.000Z" }),
    ];
    const expected = ["bravo", "alpha", "delta", "echo", "charlie"];
    expect(map(clusters, members).current.map((concept) => concept.conceptKey)).toEqual(expected);
    expect(map([...clusters].reverse(), [...members].reverse()).current.map((concept) => concept.conceptKey)).toEqual(expected);
    expect(JSON.stringify(map([...clusters].reverse(), [...members].reverse()))).toEqual(JSON.stringify(map(clusters, members)));
  });

  it("invents no score: concepts and totals expose counts and a level only", () => {
    const result = map([cluster("c1", "jira")], [member("a", "c1"), member("b", "c1")]);
    const [concept] = result.current;
    expect(Object.keys(concept)).not.toEqual(expect.arrayContaining(["score"]));
    expect(Object.keys(concept).some((key) => /score/i.test(key))).toBe(false);
    expect(Object.keys(result.totals).some((key) => /score/i.test(key))).toBe(false);
    expect(result.mapPolicyVersion).toBe(DEMAND_MAP_POLICY_VERSION);
  });

  it("uses exactly the demand_cluster_strength_v1 level rule on live counts", () => {
    const base = (index: number, source: string): DemandClusterMemberEvidence => ({ membershipId: `m${index}`, matchEvaluationId: `e${index}`, conversationId: `c${index}`, sourceKey: source, evidenceAt: "2026-09-20T00:00:00.000Z", available: true, isCurrentEvaluation: true, signalLifecycleStatus: "active", contentHash: `h${index}`, demandQuality: 0.8, confidence: 0.8, primaryIntent: "explicit_pain", sourceProducts: [], createdAt: "2026-09-20T00:00:00.000Z" });
    for (const sources of [[], ["github"], ["github", "github"], ["github", "bluesky"], ["github", "github", "x"]]) {
      const strength = computeDemandClusterStrength(sources.map((source, index) => base(index, source)), now);
      const level = demandMapLevel(strength.distinctEvidenceCount, strength.distinctSourceCount);
      expect(level ?? "inactive").toBe(strength.level);
    }
  });

  it("has no current concepts and zero headline totals when every member is excluded", () => {
    const result = map([cluster("c1", "jira")], [member("a", "c1", { persisted: { contributes: false, reason: "evaluation_superseded" }, live: { currentEvaluationId: "newer" } })]);
    expect(result.current).toEqual([]);
    expect(result.totals).toEqual({ currentConceptCount: 0, activeEvidenceCount: 0, activeSourceCount: 0, sourceMix: {}, lastActiveEvidenceAt: null });
    expect(result.previouslyObserved).toHaveLength(1);
  });
});

describe("Layer 9A feature flag", () => {
  it("only an exact 'true' enables the v2 map", () => {
    expect(demandMapV2Enabled("true")).toBe(true);
    for (const value of ["false", "TRUE", "1", "", undefined, null]) expect(demandMapV2Enabled(value)).toBe(false);
    const base = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
    expect(envSchemas.serverEnvSchema.safeParse({ ...base, DEMAND_MAP_V2_ENABLED: "true" }).success).toBe(true);
    expect(envSchemas.serverEnvSchema.safeParse({ ...base, DEMAND_MAP_V2_ENABLED: "yes" }).success).toBe(false);
  });

  it("flag OFF runs only the legacy loader and returns its result unchanged", async () => {
    const legacy = { snapshot: { id: "legacy" } };
    const loadLegacy = vi.fn(async () => legacy);
    const loadV2 = vi.fn(async () => ({ mapPolicyVersion: "demand_map_v2" }));
    const view = await loadDemandMapView({ enabled: false, loadLegacy, loadV2 });
    expect(view).toEqual({ mode: "legacy", legacy });
    expect(view.mode === "legacy" && view.legacy).toBe(legacy);
    expect(loadV2).not.toHaveBeenCalled();
  });

  it("flag ON runs only the v2 loader", async () => {
    const loadLegacy = vi.fn(async () => ({ snapshot: { id: "legacy" } }));
    const v2 = { mapPolicyVersion: "demand_map_v2" };
    const loadV2 = vi.fn(async () => v2);
    const view = await loadDemandMapView({ enabled: true, loadLegacy, loadV2 });
    expect(view).toEqual({ mode: "v2", map: v2 });
    expect(loadLegacy).not.toHaveBeenCalled();
  });
});
