import { describe, expect, it } from "vitest";

import { buildDemandDriftV2, DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE } from "../../src/server/modules/demand-intelligence/demand-drift-v2.policy";
import { driftAnchor } from "../../src/server/modules/demand-intelligence/drift-comparability";
import type { DemandMapConcept, DemandMapResolvedMember } from "../../src/server/modules/demand-intelligence/demand-map.policy";

const now = new Date("2026-09-25T12:00:00.000Z");
const anchor = driftAnchor(now); // 2026-09-25T00:00:00.000Z
const previousPeriodEnd7d = new Date(Date.parse(anchor) - 7 * 86_400_000).toISOString();
const monitoringStartedAt = "2026-08-01T00:00:00.000Z"; // well before any 7d/30d window needs

function member(id: string, evidenceAt: string, overrides: Partial<DemandMapResolvedMember> = {}): DemandMapResolvedMember {
  return { membershipId: id, clusterId: "c1", matchEvaluationId: `e-${id}`, productMatchId: `match-${id}`, conversationId: `conv-${id}`, sourceKey: "github", evidenceAt, evidenceNodeId: `node-${id}`, contributes: true, reason: null, pendingRecompute: false, ...overrides };
}

function concept(key: string, members: DemandMapResolvedMember[]): DemandMapConcept {
  return {
    conceptKey: key, identity: { clusteringVersion: "demand_clustering_v1", anchorConceptKey: key }, label: key, status: "current",
    activeEvidenceCount: members.filter((m) => m.contributes).length, activeSourceCount: new Set(members.filter((m) => m.contributes).map((m) => m.sourceKey)).size,
    sourceMix: {}, intentFamilyMix: {}, targetScopeMix: {}, level: null, firstActiveEvidenceAt: null, lastActiveEvidenceAt: null,
    observedEvidenceCount: members.length, lastObservedAt: null, exclusions: {}, updatePending: false, stateComputedAt: null, buyerLanguage: [],
    clusters: [{ clusterId: "c1", clusterKey: `concept:${key}`, label: key, intentFamily: "pain", targetScope: "market", evidenceNodeId: "node", activeEvidenceCount: members.length, persistedState: null, members }],
  };
}

/** N members packed tightly (one hour apart) just before `end` — safely inside any window >=1 day without spilling into an adjacent window. */
function membersEndingAt(prefix: string, count: number, end: string, hoursBeforeEnd = 4): DemandMapResolvedMember[] {
  const endMs = Date.parse(end);
  return Array.from({ length: count }, (_, index) => member(`${prefix}${index}`, new Date(endMs - (hoursBeforeEnd + index) * 3_600_000).toISOString()));
}

describe("Layer 9B Demand Drift v2", () => {
  it("reports no comparable movement without enough monitoring history (drift_comparability_v1 preserved)", () => {
    const model = buildDemandDriftV2({ concepts: [], window: "7d", now, monitoringStartedAt: null });
    expect(model).toMatchObject({ comparable: false, reason: "insufficient_history", rising: [], cooling: [] });
  });

  it("requires >=5 valid items in BOTH windows before assigning a direction; otherwise insufficient", () => {
    const sparse = concept("jira", [...membersEndingAt("c", 3, anchor), ...membersEndingAt("p", 3, previousPeriodEnd7d)]);
    const model = buildDemandDriftV2({ concepts: [sparse], window: "7d", now, monitoringStartedAt });
    expect(model.comparable).toBe(true);
    expect(model.items[0]).toMatchObject({ direction: "insufficient_data", significance: "insufficient", currentCount: 3, previousCount: 3 });
    expect(model.rising).toEqual([]);
    expect(model.cooling).toEqual([]);
  });

  it("assigns rising when current-window evidence clearly grew over the previous window", () => {
    const rising = concept("jira", [...membersEndingAt("c", 8, anchor), ...membersEndingAt("p", 5, previousPeriodEnd7d)]);
    const model = buildDemandDriftV2({ concepts: [rising], window: "7d", now, monitoringStartedAt });
    expect(model.rising.map((item) => item.conceptKey)).toEqual(["jira"]);
    expect(model.items[0]).toMatchObject({ currentCount: 8, previousCount: 5 });
  });

  it("assigns cooling when current-window evidence clearly shrank", () => {
    const cooling = concept("jira", [...membersEndingAt("c", 5, anchor), ...membersEndingAt("p", 8, previousPeriodEnd7d)]);
    const model = buildDemandDriftV2({ concepts: [cooling], window: "7d", now, monitoringStartedAt });
    expect(model.cooling.map((item) => item.conceptKey)).toEqual(["jira"]);
  });

  it("excludes non-contributing (invalidated/superseded/stale) evidence from both windows", () => {
    const members = membersEndingAt("c", 8, anchor).map((m, index) => (index < 3 ? { ...m, contributes: false, reason: "signal_invalidated" as const } : m));
    const model = buildDemandDriftV2({ concepts: [concept("jira", members)], window: "7d", now, monitoringStartedAt });
    expect(model.items[0].currentCount).toBe(5);
  });

  it("drops a concept from the result entirely when it has zero evidence in both windows", () => {
    const empty = concept("ghost", []);
    const model = buildDemandDriftV2({ concepts: [empty], window: "7d", now, monitoringStartedAt });
    expect(model.items).toEqual([]);
  });

  it("shows no current movement, honestly, when there is zero current evidence across every concept", () => {
    const onlyPrevious = concept("jira", membersEndingAt("p", 8, previousPeriodEnd7d));
    const model = buildDemandDriftV2({ concepts: [onlyPrevious], window: "7d", now, monitoringStartedAt });
    expect(model.rising).toEqual([]);
    expect(model.items[0].currentCount).toBe(0);
  });

  it("30d and 90d windows are honest about the canonical 90-day currentness bound: a 90d window's older leg is typically insufficient", () => {
    // The previous period of a 90d comparison spans 90-180 days ago. Evidence at
    // 95 days old sits inside that window range but is already stale under the
    // canonical <=90-day currentness rule, so DemandCurrentnessService would
    // already have resolved it non-contributing before Drift v2 ever sees it.
    const previousPeriodEnd90d = new Date(Date.parse(anchor) - 90 * 86_400_000).toISOString();
    const staleOldEvidence = membersEndingAt("p", 8, previousPeriodEnd90d, 5 * 24).map((m) => ({ ...m, contributes: false, reason: "stale" as const }));
    const model = buildDemandDriftV2({ concepts: [concept("jira", [...membersEndingAt("c", 8, anchor), ...staleOldEvidence])], window: "90d", now, monitoringStartedAt: "2026-01-01T00:00:00.000Z" });
    expect(model.comparable).toBe(true);
    expect(model.items[0]).toMatchObject({ direction: "insufficient_data", previousCount: 0, currentCount: 8 });
  });

  it("never presents legacy drift as current: the policy has no legacy input at all", () => {
    const model = buildDemandDriftV2({ concepts: [], window: "30d", now, monitoringStartedAt });
    expect(model).not.toHaveProperty("legacy");
    expect(DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE).toBe(5);
  });
});
