import { describe, expect, it } from "vitest";

import { demandMapHeadline, exclusionSummary, historicalCaption, marketStateCopy } from "../../src/components/dashboard/demand-map-concepts";
import type { DemandMapConcept, DemandMapV2ReadModel } from "../../src/server/modules/demand-intelligence/demand-map.policy";

function concept(overrides: Partial<DemandMapConcept> = {}): DemandMapConcept {
  return {
    conceptKey: "jira", identity: { clusteringVersion: "demand_clustering_v1", anchorConceptKey: "jira" }, label: "Jira", status: "current",
    activeEvidenceCount: 2, activeSourceCount: 2, sourceMix: { bluesky: 1, github: 1 }, intentFamilyMix: { switch: 2 }, targetScopeMix: { market: 2 },
    level: "corroborated", firstActiveEvidenceAt: "2026-09-10T00:00:00.000Z", lastActiveEvidenceAt: "2026-09-20T00:00:00.000Z",
    observedEvidenceCount: 2, lastObservedAt: "2026-09-20T00:00:00.000Z", exclusions: {}, updatePending: false, stateComputedAt: null, buyerLanguage: [], clusters: [],
    ...overrides,
  };
}

const legacy = { snapshot: { period_start: "2026-08-26T00:00:00.000Z", period_end: "2026-09-25T00:00:00.000Z", sample_size: 7, qualified_signal_count: 8 } } as unknown as NonNullable<DemandMapV2ReadModel["historical"]["legacy"]>;

function model(current: DemandMapConcept[], previouslyObserved: DemandMapConcept[]): DemandMapV2ReadModel {
  const conversations = current.reduce((sum, item) => sum + item.activeEvidenceCount, 0);
  return {
    mapPolicyVersion: "demand_map_v2", clusteringVersion: "demand_clustering_v1", strengthVersion: "demand_cluster_strength_v1", generatedAt: "2026-09-25T12:00:00.000Z", staleBefore: "2026-06-27T12:00:00.000Z",
    totals: { currentConceptCount: current.length, activeEvidenceCount: conversations, activeSourceCount: current.length ? 2 : 0, sourceMix: {}, lastActiveEvidenceAt: null },
    current, previouslyObserved, historical: { label: "not_lifecycle_filtered", legacy },
    diagnostics: { clustersRead: 0, membershipsRead: 0, statesRead: 0, statesTruncated: false, updatePending: false },
  };
}

const excluded = concept({ status: "historical", activeEvidenceCount: 0, activeSourceCount: 0, level: null, observedEvidenceCount: 11, exclusions: { signal_invalidated: 1, evaluation_superseded: 10 } });

describe("Layer 9A demand map copy", () => {
  it("shows a truthful empty state when no concept is current, even though legacy history exists", () => {
    const headline = demandMapHeadline(model([], [excluded]));
    expect(headline).toMatchObject({ state: "none_current", title: "No current demand confirmed" });
    expect(headline.body).not.toMatch(/\d+ (qualified )?signals?/);
    expect(marketStateCopy(model([], [excluded]))).toBe("No current demand confirmed.");
    expect(demandMapHeadline(model([], []))).toMatchObject({ state: "none_clustered", title: "No current demand confirmed" });
  });

  it("builds current headlines only from live totals, never from legacy snapshot counts", () => {
    const current = model([concept()], [excluded]);
    expect(demandMapHeadline(current)).toEqual({ state: "current", title: "Current demand", body: "1 demand concept backed by 2 distinct conversations from 2 sources." });
    expect(marketStateCopy(current)).toBe("Jira leads current demand with 2 distinct conversations from 2 sources.");
    // The legacy snapshot's 8 "qualified signals" / 7 conversations must not appear anywhere in current copy.
    for (const text of [demandMapHeadline(current).body, marketStateCopy(current)]) expect(text).not.toMatch(/\b[78]\b/);
  });

  it("explains why previously observed evidence is not current, largest reason first", () => {
    expect(exclusionSummary(excluded.exclusions)).toBe("10 re-evaluated below the qualification bar · 1 invalidated");
    expect(exclusionSummary({ stale: 1, signal_retracted: 1, not_in_latest_state: 2 })).toBe("2 awaiting recompute · 1 retracted · 1 older than 90 days");
  });

  it("labels the legacy snapshot as a dated historical sample", () => {
    expect(historicalCaption(legacy)).toMatch(/^Snapshot .+ - .+, 7 conversations\.$/);
  });
});
