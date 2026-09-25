import { describe, expect, it } from "vitest";

import {
  CONCEPT_GAP_STATE_POLICY_VERSION,
  CONCEPT_MARKET_STATE_POLICY_VERSION,
  conceptDriftStateInputFingerprint,
  conceptGapStateInputFingerprint,
  conceptGapStatus,
  conceptMarketStateInputFingerprint,
} from "../../src/server/modules/demand-intelligence/concept-market-state.policy";
import type { DemandMapConcept, DemandMapResolvedMember } from "../../src/server/modules/demand-intelligence/demand-map.policy";

function member(id: string, overrides: Partial<DemandMapResolvedMember> = {}): DemandMapResolvedMember {
  return { membershipId: id, clusterId: "c1", matchEvaluationId: `e-${id}`, productMatchId: `m-${id}`, conversationId: `conv-${id}`, sourceKey: "github", evidenceAt: "2026-09-20T00:00:00.000Z", evidenceNodeId: `node-${id}`, contributes: true, reason: null, pendingRecompute: false, ...overrides };
}

function concept(clusteringVersion: string, anchorConceptKey: string, clusters: Array<{ members: DemandMapResolvedMember[] }>): Pick<DemandMapConcept, "identity"> & { clusters: Array<{ members: DemandMapResolvedMember[] }> } {
  return { identity: { clusteringVersion, anchorConceptKey }, clusters };
}

describe("Layer 9C concept market state policy", () => {
  describe("conceptGapStatus", () => {
    it("is no_current_demand at zero, directional below the scoring floor, scored at/above it", () => {
      expect(conceptGapStatus(0)).toBe("no_current_demand");
      expect(conceptGapStatus(1)).toBe("directional");
      expect(conceptGapStatus(4)).toBe("directional");
      expect(conceptGapStatus(5)).toBe("scored");
      expect(conceptGapStatus(50)).toBe("scored");
    });
  });

  describe("conceptMarketStateInputFingerprint", () => {
    it("is deterministic and order-independent (sorted by membershipId)", () => {
      const a = member("a"); const b = member("b", { contributes: false, reason: "signal_invalidated" });
      const forward = conceptMarketStateInputFingerprint(concept("demand_clustering_v1", "jira", [{ members: [a, b] }]));
      const reversed = conceptMarketStateInputFingerprint(concept("demand_clustering_v1", "jira", [{ members: [b, a] }]));
      expect(forward).toBe(reversed);
      expect(forward).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when clustering_version differs, even with identical membership content — two clustering versions never share one fingerprint namespace", () => {
      const members = [member("a")];
      const v1 = conceptMarketStateInputFingerprint(concept("demand_clustering_v1", "jira", [{ members }]));
      const v2 = conceptMarketStateInputFingerprint(concept("demand_clustering_v2", "jira", [{ members }]));
      expect(v1).not.toBe(v2);
    });

    it("changes when any membership's contributes/reason changes (a lifecycle change produces a new fingerprint)", () => {
      const before = conceptMarketStateInputFingerprint(concept("demand_clustering_v1", "jira", [{ members: [member("a")] }]));
      const after = conceptMarketStateInputFingerprint(concept("demand_clustering_v1", "jira", [{ members: [member("a", { contributes: false, reason: "evaluation_superseded" })] }]));
      expect(before).not.toBe(after);
    });

    it("is unchanged for a byte-identical recomputation (idempotent replay input)", () => {
      const build = () => concept("demand_clustering_v1", "jira", [{ members: [member("a"), member("b", { contributes: false, reason: "stale" })] }]);
      expect(conceptMarketStateInputFingerprint(build())).toBe(conceptMarketStateInputFingerprint(build()));
    });

    it("includes the policy version, not just clustering identity", () => {
      expect(CONCEPT_MARKET_STATE_POLICY_VERSION).toBe("concept_market_state_v1");
    });
  });

  describe("conceptGapStateInputFingerprint", () => {
    it("changes when the positioning snapshot changes, even with the same market-state basis", () => {
      const base = { marketStateId: "m1", marketStateInputFingerprint: "f".repeat(64) };
      const a = conceptGapStateInputFingerprint({ ...base, productSnapshotId: "s1", productSnapshotContentHash: "h1" });
      const b = conceptGapStateInputFingerprint({ ...base, productSnapshotId: "s2", productSnapshotContentHash: "h2" });
      expect(a).not.toBe(b);
    });

    it("changes when the market state's own fingerprint changes, even with the same market-state id (never trusts the id alone)", () => {
      const a = conceptGapStateInputFingerprint({ marketStateId: "m1", marketStateInputFingerprint: "a".repeat(64), productSnapshotId: "s1", productSnapshotContentHash: "h1" });
      const b = conceptGapStateInputFingerprint({ marketStateId: "m1", marketStateInputFingerprint: "b".repeat(64), productSnapshotId: "s1", productSnapshotContentHash: "h1" });
      expect(a).not.toBe(b);
      expect(CONCEPT_GAP_STATE_POLICY_VERSION).toBe("concept_gap_state_v1");
    });
  });

  describe("conceptDriftStateInputFingerprint", () => {
    const base = {
      clusteringVersion: "demand_clustering_v1", anchorConceptKey: "jira", window: "7d",
      previousPeriodStart: "2026-09-11T00:00:00.000Z", previousPeriodEnd: "2026-09-18T00:00:00.000Z",
      currentPeriodStart: "2026-09-18T00:00:00.000Z", currentPeriodEnd: "2026-09-25T00:00:00.000Z",
      monitoringStartedAtBasis: "2026-08-01T00:00:00.000Z",
    };

    it("is order-independent within each window's membership set", () => {
      const forward = conceptDriftStateInputFingerprint({ ...base, currentWindowMemberIds: ["a", "b"], previousWindowMemberIds: ["x", "y"] });
      const reversed = conceptDriftStateInputFingerprint({ ...base, currentWindowMemberIds: ["b", "a"], previousWindowMemberIds: ["y", "x"] });
      expect(forward).toBe(reversed);
    });

    it("changes when the exact membership sets differ, even with identical counts — never counts alone", () => {
      const a = conceptDriftStateInputFingerprint({ ...base, currentWindowMemberIds: ["a", "b"], previousWindowMemberIds: [] });
      const b = conceptDriftStateInputFingerprint({ ...base, currentWindowMemberIds: ["a", "c"], previousWindowMemberIds: [] });
      expect(a).not.toBe(b);
    });

    it("changes when period boundaries shift (a new day's driftAnchor), even with unchanged membership sets", () => {
      const day1 = conceptDriftStateInputFingerprint({ ...base, currentWindowMemberIds: ["a"], previousWindowMemberIds: [] });
      const day2 = conceptDriftStateInputFingerprint({ ...base, currentPeriodEnd: "2026-09-26T00:00:00.000Z", currentWindowMemberIds: ["a"], previousWindowMemberIds: [] });
      expect(day1).not.toBe(day2);
    });

    it("changes when the monitoring-history basis changes", () => {
      const a = conceptDriftStateInputFingerprint({ ...base, currentWindowMemberIds: [], previousWindowMemberIds: [] });
      const b = conceptDriftStateInputFingerprint({ ...base, monitoringStartedAtBasis: "2026-07-01T00:00:00.000Z", currentWindowMemberIds: [], previousWindowMemberIds: [] });
      expect(a).not.toBe(b);
    });

    it("is stable (never just the two market-state ids) — a not-comparable state with null periods still fingerprints deterministically", () => {
      const input = { clusteringVersion: "demand_clustering_v1", anchorConceptKey: "jira", window: "90d", previousPeriodStart: null, previousPeriodEnd: null, currentPeriodStart: null, currentPeriodEnd: null, monitoringStartedAtBasis: null, currentWindowMemberIds: [], previousWindowMemberIds: [] };
      expect(conceptDriftStateInputFingerprint(input)).toBe(conceptDriftStateInputFingerprint({ ...input }));
    });
  });
});
