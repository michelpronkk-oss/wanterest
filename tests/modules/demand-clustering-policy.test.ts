import { describe, expect, it } from "vitest";

import {
  computeDemandClusterStrength,
  DEMAND_CLUSTERING_VERSION,
  demandClusterIdentity,
  explainDemandCluster,
  intentFamilyOf,
  normalizeConceptKey,
  targetScopeOf,
  type DemandClusterMemberEvidence,
} from "../../src/server/modules/demand-intelligence";
import { now, productA, qualification } from "./demand-clustering.fixtures";

function member(id: string, overrides: Partial<DemandClusterMemberEvidence> = {}): DemandClusterMemberEvidence {
  return { membershipId: id, matchEvaluationId: `evaluation-${id}`, conversationId: `conversation-${id}`, sourceKey: "github", evidenceAt: "2026-09-18T00:00:00.000Z", available: true, isCurrentEvaluation: true, signalLifecycleStatus: "active", contentHash: `hash-${id}`, demandQuality: 0.8, confidence: 0.75, primaryIntent: "explicit_pain", sourceProducts: [], createdAt: "2026-09-20T00:00:00.000Z", ...overrides };
}

describe("Stage 2G demand clustering identity (demand_clustering_v1)", () => {
  it("is deterministic and built only from stored qualification primitives", () => {
    const first = demandClusterIdentity(qualification({ productId: productA, concepts: ["sprint_planning", "issue_tracking"], intent: "explicit_pain" }), true);
    const second = demandClusterIdentity(qualification({ productId: productA, concepts: ["sprint_planning", "issue_tracking"], intent: "explicit_pain" }), true);
    expect(first).toEqual(second);
    expect(first.clusterable && first.identity.clusterKey).toBe("concept:sprint_planning|intent:pain|target:market");
    expect(first.clusterable && first.identity.clusteringVersion).toBe(DEMAND_CLUSTERING_VERSION);
  });

  it("anchors on the first matched profile concept only, so evidence is never counted twice", () => {
    const identity = demandClusterIdentity(qualification({ productId: productA, concepts: ["issue_tracking", "sprint_planning"] }), true);
    expect(identity.clusterable && identity.identity.anchorConceptKey).toBe("issue_tracking");
    expect(identity.clusterable && identity.identity.assignment.matchedProfileConcepts).toEqual(["issue_tracking", "sprint_planning"]);
  });

  it("keeps unrelated requests apart: different concept, intent family, or target scope never share a key", () => {
    const key = (concepts: string[], intent: Parameters<typeof qualification>[0]["intent"], target: Parameters<typeof qualification>[0]["target"]) => {
      const result = demandClusterIdentity(qualification({ productId: productA, concepts, intent, target }), true);
      return result.clusterable ? result.identity.clusterKey : null;
    };
    const base = key(["sprint_planning"], "explicit_pain", "category");
    expect(key(["roadmap_visibility"], "explicit_pain", "category")).not.toBe(base);
    expect(key(["sprint_planning"], "switching_intent", "category")).not.toBe(base);
    expect(key(["sprint_planning"], "feature_requirement", "category")).not.toBe(base);
    expect(key(["sprint_planning"], "explicit_pain", "scanned_product")).not.toBe(base);
    // Same family and scope: grouped.
    expect(key(["sprint_planning"], "unmet_need", "third_party_product")).toBe(base);
  });

  it("refuses to cluster unqualified evidence or evidence with no profile concept", () => {
    expect(demandClusterIdentity(qualification({ productId: productA, concepts: ["sprint_planning"], status: "weak_candidate" }), false)).toEqual({ clusterable: false, reason: "not_qualified" });
    expect(demandClusterIdentity(null, true)).toEqual({ clusterable: false, reason: "not_qualified" });
    expect(demandClusterIdentity(qualification({ productId: productA, concepts: [] }), true)).toEqual({ clusterable: false, reason: "no_profile_concept" });
  });

  it("maps intents and targets into explicit, closed families", () => {
    expect(intentFamilyOf("alternative_search")).toBe("switch");
    expect(intentFamilyOf("vendor_evaluation")).toBe("evaluate");
    expect(intentFamilyOf("feature_requirement")).toBe("capability");
    expect(intentFamilyOf("problem_solution_search")).toBe("pain");
    expect(intentFamilyOf("unknown")).toBe("unspecified");
    expect(targetScopeOf("scanned_product")).toBe("product");
    expect(targetScopeOf("implementation")).toBe("implementation");
    expect(targetScopeOf("unknown")).toBe("market");
    expect(normalizeConceptKey("Sprint Planning!")).toBe("sprint_planning");
    expect(normalizeConceptKey("***")).toBeNull();
  });
});

describe("Stage 2G strength (demand_cluster_strength_v1)", () => {
  it("increases with distinct evidence and records transparent components", () => {
    const one = computeDemandClusterStrength([member("a")], now);
    const two = computeDemandClusterStrength([member("a"), member("b")], now);
    expect(one.level).toBe("single");
    expect(two.level).toBe("repeated");
    expect(two.score).toBeGreaterThan(one.score);
    expect(two.components).toMatchObject({ evidenceFactor: 0.75, sourceFactor: 0.85 });
  });

  it("does not strengthen from the same conversation or identical content twice", () => {
    const base = computeDemandClusterStrength([member("a")], now);
    const sameConversation = computeDemandClusterStrength([member("a"), member("b", { conversationId: "conversation-a", contentHash: "hash-b" })], now);
    const sameContent = computeDemandClusterStrength([member("a"), member("b", { contentHash: "hash-a" })], now);
    expect(sameConversation.score).toBe(base.score);
    expect(sameConversation.exclusions).toEqual({ duplicate_conversation: 1 });
    expect(sameContent.score).toBe(base.score);
    expect(sameContent.exclusions).toEqual({ duplicate_content: 1 });
  });

  it("corroborates only with a second source and reports the source mix", () => {
    const corroborated = computeDemandClusterStrength([member("a"), member("b", { sourceKey: "stack-exchange" })], now);
    expect(corroborated.level).toBe("corroborated");
    expect(corroborated.sourceMix).toEqual({ github: 1, "stack-exchange": 1 });
    expect(corroborated.score).toBeGreaterThan(computeDemandClusterStrength([member("a"), member("b")], now).score);
  });

  it("excludes superseded, invalidated, retracted, stale and unavailable evidence from active strength", () => {
    const strength = computeDemandClusterStrength([
      member("current"),
      member("superseded", { isCurrentEvaluation: false }),
      member("invalidated", { signalLifecycleStatus: "invalidated" }),
      member("retracted", { signalLifecycleStatus: "retracted" }),
      member("stale", { evidenceAt: "2026-05-01T00:00:00.000Z" }),
      member("missing", { available: false }),
    ], now);
    expect(strength.distinctEvidenceCount).toBe(1);
    expect(strength.exclusions).toEqual({ evaluation_superseded: 1, evidence_unavailable: 1, signal_invalidated: 1, signal_retracted: 1, stale: 1 });
  });

  it("keeps dismissed, saved and archived signals as evidence and reports the lifecycle mix", () => {
    const strength = computeDemandClusterStrength([member("a", { signalLifecycleStatus: "dismissed" }), member("b", { signalLifecycleStatus: "saved" }), member("c", { signalLifecycleStatus: null })], now);
    expect(strength.distinctEvidenceCount).toBe(3);
    expect(strength.lifecycleMix).toEqual({ dismissed: 1, no_signal: 1, saved: 1 });
  });

  it("produces an order-independent fingerprint and an inactive level with no contributors", () => {
    const left = computeDemandClusterStrength([member("a"), member("b")], now);
    const right = computeDemandClusterStrength([member("b"), member("a")], now);
    expect(left.inputFingerprint).toBe(right.inputFingerprint);
    const inactive = computeDemandClusterStrength([member("a", { signalLifecycleStatus: "invalidated" })], now);
    expect(inactive).toMatchObject({ level: "inactive", score: 0, distinctEvidenceCount: 0, firstEvidenceAt: null });
  });

  it("explains why evidence is grouped", () => {
    expect(explainDemandCluster({ anchorConceptKey: "sprint_planning", intentFamily: "pain", targetScope: "market", distinctEvidenceCount: 2, distinctSourceCount: 1 }))
      .toBe('2 distinct pieces of evidence from 1 source matched the product profile concept "sprint_planning" as their primary concept, with intent family "pain" (explicit_pain, unmet_need, problem_solution_search) and target scope "market".');
  });
});
