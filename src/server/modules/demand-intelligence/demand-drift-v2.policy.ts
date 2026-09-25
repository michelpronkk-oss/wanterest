import { planDriftComparison, type DriftSkipReason } from "./drift-comparability";
import { calculateDriftDirection, calculateGrowthRate, calculateSignificance } from "./demand.engines";
import type { DemandMapConcept, DemandMapResolvedMember } from "./demand-map.policy";

/**
 * Wanterest Layer 9B: Demand Drift v2. Pure, not persisted. Buckets the SAME
 * currentness-validated evidence Layer 9A's Map uses (never a second lifecycle
 * definition) into adjacent, day-anchored windows using the frozen
 * drift_comparability_v1 anchoring/history rules and the frozen
 * calculateDriftDirection/calculateSignificance/calculateGrowthRate formulas.
 * See docs/architecture.md §17.
 */

export const DEMAND_DRIFT_V2_POLICY_VERSION = "demand_drift_v2" as const;
/** Both windows need at least this many distinct, currently-valid items before a direction is assigned. */
export const DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE = 5;

export type DemandDriftV2Item = {
  conceptKey: string;
  label: string;
  identity: DemandMapConcept["identity"];
  direction: "rising" | "cooling" | "stable" | "insufficient_data";
  significance: "insufficient" | "weak" | "notable" | "strong";
  currentCount: number;
  previousCount: number;
  currentSourceCount: number;
  previousSourceCount: number;
  currentShare: number;
  previousShare: number;
  shareDelta: number;
  growthRate: number | null;
  /** Frozen, sorted membership ids in each window — Layer 9C's provenance/fingerprint input. Additive; the live page ignores these. */
  currentWindowMemberIds: string[];
  previousWindowMemberIds: string[];
};

export type DemandDriftV2ReadModel =
  | { policyVersion: typeof DEMAND_DRIFT_V2_POLICY_VERSION; generatedAt: string; window: string; comparable: false; reason: DriftSkipReason; rising: []; cooling: []; items: [] }
  | { policyVersion: typeof DEMAND_DRIFT_V2_POLICY_VERSION; generatedAt: string; window: string; comparable: true; currentPeriodEnd: string; previousPeriodEnd: string; previousPeriodStart: string; rising: DemandDriftV2Item[]; cooling: DemandDriftV2Item[]; items: DemandDriftV2Item[] };

export type WindowMembers = { count: number; sourceCount: number; memberIds: string[] };

/**
 * Currently-valid (contributes=true), distinct-per-conversation members whose
 * evidence falls in [startIso, endIso). Exported so Layer 9C's materialization
 * freezes the exact same window bucketing Drift v2 computes live — one
 * implementation, not two. `memberIds` is the frozen membership id set (sorted)
 * Layer 9C uses for provenance and fingerprinting.
 */
export function windowMembers(members: DemandMapResolvedMember[], startIso: string, endIso: string): WindowMembers {
  const inWindow = members
    .filter((member) => member.contributes && member.evidenceAt >= startIso && member.evidenceAt < endIso)
    .sort((left, right) => left.evidenceAt.localeCompare(right.evidenceAt) || left.membershipId.localeCompare(right.membershipId));
  const seen = new Set<string>();
  const sources = new Set<string>();
  const memberIds: string[] = [];
  for (const member of inWindow) {
    if (seen.has(member.conversationId)) continue;
    seen.add(member.conversationId);
    sources.add(member.sourceKey);
    memberIds.push(member.membershipId);
  }
  return { count: memberIds.length, sourceCount: sources.size, memberIds: memberIds.sort() };
}

export type DriftComparisonPlan = { comparable: true; currentPeriodEnd: string; previousPeriodEnd: string; previousPeriodStart: string };

/** Windows every concept independently, unfiltered — Layer 9C materializes every concept (including zero/zero) while the live view below filters them out. */
export function computeDriftWindowsForConcepts(concepts: DemandMapConcept[], plan: DriftComparisonPlan): Array<{ concept: DemandMapConcept; current: WindowMembers; previous: WindowMembers }> {
  return concepts.map((concept) => {
    const members = concept.clusters.flatMap((cluster) => cluster.members);
    return { concept, current: windowMembers(members, plan.previousPeriodEnd, plan.currentPeriodEnd), previous: windowMembers(members, plan.previousPeriodStart, plan.previousPeriodEnd) };
  });
}

/** One concept's frozen item, given precomputed windows and the batch's totals. Shared by the live view and Layer 9C materialization — one implementation. */
export function buildDemandDriftV2Item(concept: DemandMapConcept, current: WindowMembers, previous: WindowMembers, totalCurrent: number, totalPrevious: number): DemandDriftV2Item {
  const enoughSample = current.count >= DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE && previous.count >= DEMAND_DRIFT_V2_MIN_WINDOW_EVIDENCE;
  const currentShare = totalCurrent ? current.count / totalCurrent : 0;
  const previousShare = totalPrevious ? previous.count / totalPrevious : 0;
  return {
    conceptKey: concept.conceptKey, label: concept.label, identity: concept.identity,
    direction: calculateDriftDirection(currentShare, previousShare, current.count, previous.count, enoughSample),
    significance: calculateSignificance(currentShare - previousShare, enoughSample),
    currentCount: current.count, previousCount: previous.count, currentSourceCount: current.sourceCount, previousSourceCount: previous.sourceCount,
    currentShare, previousShare, shareDelta: currentShare - previousShare, growthRate: calculateGrowthRate(current.count, previous.count),
    currentWindowMemberIds: current.memberIds, previousWindowMemberIds: previous.memberIds,
  };
}

/**
 * `concepts` should be every concept (current AND previously-observed): a
 * concept with 0 current evidence can still legitimately be "cooling" if it had
 * valid evidence in the previous window. `monitoringStartedAt` preserves the
 * existing drift_comparability_v1 history requirement (from one bounded read).
 */
export function buildDemandDriftV2(input: { concepts: DemandMapConcept[]; window: string; now: Date; monitoringStartedAt: string | null }): DemandDriftV2ReadModel {
  const generatedAt = input.now.toISOString();
  const plan = planDriftComparison({ window: input.window, now: input.now, monitoringStartedAt: input.monitoringStartedAt });
  if (!plan.comparable) return { policyVersion: DEMAND_DRIFT_V2_POLICY_VERSION, generatedAt, window: input.window, comparable: false, reason: plan.reason, rising: [], cooling: [], items: [] };

  const allWindows = computeDriftWindowsForConcepts(input.concepts, plan);
  const totalCurrent = allWindows.reduce((sum, row) => sum + row.current.count, 0);
  const totalPrevious = allWindows.reduce((sum, row) => sum + row.previous.count, 0);

  // The live view only shows concepts with evidence in at least one window; a
  // concept with none in either is not meaningful to display as a trend.
  const items: DemandDriftV2Item[] = allWindows
    .filter((row) => row.current.count > 0 || row.previous.count > 0)
    .map((row) => buildDemandDriftV2Item(row.concept, row.current, row.previous, totalCurrent, totalPrevious))
    .sort((left, right) => left.conceptKey.localeCompare(right.conceptKey));

  const rising = items.filter((item) => item.direction === "rising").sort((left, right) => right.shareDelta - left.shareDelta);
  const cooling = items.filter((item) => item.direction === "cooling").sort((left, right) => left.shareDelta - right.shareDelta);

  return { policyVersion: DEMAND_DRIFT_V2_POLICY_VERSION, generatedAt, window: input.window, comparable: true, currentPeriodEnd: plan.currentPeriodEnd, previousPeriodEnd: plan.previousPeriodEnd, previousPeriodStart: plan.previousPeriodStart, rising, cooling, items };
}
