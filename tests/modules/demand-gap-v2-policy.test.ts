import { describe, expect, it } from "vitest";

import { buildDemandGapV2, DEMAND_GAP_V2_MIN_SCORED_EVIDENCE, demandGapV2SampleQuality } from "../../src/server/modules/demand-intelligence/demand-gap-v2.policy";
import type { DemandMapConcept } from "../../src/server/modules/demand-intelligence/demand-map.policy";
import type { ProductSnapshotRow } from "../../src/server/db/database.helpers";

const now = new Date("2026-09-25T12:00:00.000Z");

function concept(overrides: Partial<DemandMapConcept> = {}): DemandMapConcept {
  return {
    conceptKey: "jira", identity: { clusteringVersion: "demand_clustering_v1", anchorConceptKey: "jira" }, label: "Jira", status: "current",
    activeEvidenceCount: 6, activeSourceCount: 2, sourceMix: { github: 4, bluesky: 2 }, intentFamilyMix: { switch: 6 }, targetScopeMix: { market: 6 },
    level: "corroborated", firstActiveEvidenceAt: "2026-09-01T00:00:00.000Z", lastActiveEvidenceAt: "2026-09-20T00:00:00.000Z",
    observedEvidenceCount: 6, lastObservedAt: "2026-09-20T00:00:00.000Z", exclusions: {}, updatePending: false, stateComputedAt: null, buyerLanguage: [], clusters: [],
    ...overrides,
  };
}

const snapshot = { normalized_text: "linear helps teams plan sprints", raw_text: "Linear helps teams plan sprints and ship software.", page_type: "manual" } as unknown as ProductSnapshotRow;

describe("Layer 9B Demand Gap v2", () => {
  it("produces no current gap when there are no current concepts", () => {
    const model = buildDemandGapV2({ current: [], positioning: snapshot, now });
    expect(model).toMatchObject({ hasCurrentEvidence: false, items: [] });
  });

  it("is directional only, never scored, below the minimum current evidence threshold", () => {
    for (const count of [1, 2, 3, 4]) {
      const model = buildDemandGapV2({ current: [concept({ activeEvidenceCount: count, activeSourceCount: 1, intentFamilyMix: { switch: count } })], positioning: snapshot, now });
      expect(model.items[0]).toMatchObject({ scored: false, gapScore: null, sampleQuality: "insufficient_data" });
      expect(model.items[0].interpretation).toMatch(new RegExp(`fewer than ${DEMAND_GAP_V2_MIN_SCORED_EVIDENCE}`));
    }
  });

  it("scores deterministically once current evidence reaches the minimum", () => {
    const model = buildDemandGapV2({ current: [concept({ activeEvidenceCount: 5, activeSourceCount: 1, intentFamilyMix: { switch: 5 } })], positioning: snapshot, now });
    const again = buildDemandGapV2({ current: [concept({ activeEvidenceCount: 5, activeSourceCount: 1, intentFamilyMix: { switch: 5 } })], positioning: snapshot, now });
    expect(model.items[0].scored).toBe(true);
    expect(model.items[0].gapScore).not.toBeNull();
    expect(model.items[0].gapScore).toBe(again.items[0].gapScore);
  });

  it("reuses the frozen positioning-weight formula unmodified (higher term coverage in the snapshot text lowers the gap)", () => {
    const covered = buildDemandGapV2({ current: [concept({ label: "Linear", identity: { clusteringVersion: "demand_clustering_v1", anchorConceptKey: "plan_sprints" } })], positioning: snapshot, now });
    const uncovered = buildDemandGapV2({ current: [concept({ label: "Jira alternative", identity: { clusteringVersion: "demand_clustering_v1", anchorConceptKey: "jira_alternative" } })], positioning: snapshot, now });
    expect(covered.items[0].positioningWeight).toBeGreaterThan(uncovered.items[0].positioningWeight);
    expect(covered.items[0].gapScore).toBeLessThan(uncovered.items[0].gapScore ?? 1);
  });

  it("never fabricates positioning coverage when there is no snapshot", () => {
    const model = buildDemandGapV2({ current: [concept()], positioning: null, now });
    expect(model.items[0].positioningWeight).toBe(0);
  });

  it("computes high-intent share from switch/evaluate intent families only", () => {
    const model = buildDemandGapV2({ current: [concept({ activeEvidenceCount: 10, intentFamilyMix: { switch: 4, evaluate: 2, pain: 4 } })], positioning: null, now });
    expect(model.items[0].highIntentShare).toBeCloseTo(0.6);
  });

  it("shares current demand across current concepts only (not legacy sample size)", () => {
    const model = buildDemandGapV2({ current: [concept({ conceptKey: "a", activeEvidenceCount: 8 }), concept({ conceptKey: "b", activeEvidenceCount: 2, intentFamilyMix: { switch: 2 } })], positioning: null, now });
    const a = model.items.find((item) => item.conceptKey === "a")!;
    const b = model.items.find((item) => item.conceptKey === "b")!;
    expect(a.shareOfCurrentDemand).toBeCloseTo(0.8);
    expect(b.shareOfCurrentDemand).toBeCloseTo(0.2);
  });

  it("uses the same four-tier sample-quality bucketing demand.service.ts already uses", () => {
    expect(demandGapV2SampleQuality(3)).toBe("insufficient_data");
    expect(demandGapV2SampleQuality(10)).toBe("low_confidence");
    expect(demandGapV2SampleQuality(30)).toBe("normal");
    expect(demandGapV2SampleQuality(60)).toBe("high_confidence");
  });

  it("ranks scored gaps above directional ones, highest first, deterministically", () => {
    const low = concept({ conceptKey: "low", activeEvidenceCount: 5, activeSourceCount: 1, intentFamilyMix: { pain: 5 } });
    const high = concept({ conceptKey: "high", activeEvidenceCount: 5, activeSourceCount: 2, intentFamilyMix: { switch: 5 } });
    const directional = concept({ conceptKey: "directional", activeEvidenceCount: 2, intentFamilyMix: { switch: 2 } });
    const model = buildDemandGapV2({ current: [low, directional, high], positioning: null, now });
    expect(model.items.map((item) => item.conceptKey)).toEqual(["high", "low", "directional"]);
  });
});
