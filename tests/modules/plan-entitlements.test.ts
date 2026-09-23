import { describe, expect, it } from "vitest";

import {
  PLAN_CAPABILITIES,
  getPlanCapabilities,
  getProviderBudget,
  getScanBudget,
  resolveInternalPlan,
  scanProfileForMode,
} from "../../src/server/modules/entitlements/plan-capabilities";

describe("Plan Entitlements + Source Budget Matrix v1", () => {
  it("defaults missing or inactive billing state to Free", () => {
    expect(resolveInternalPlan(undefined)).toBe("free");
    expect(resolveInternalPlan(null)).toBe("free");
    expect(resolveInternalPlan({ internalPlan: "pro", status: "canceled" })).toBe("free");
    expect(resolveInternalPlan({ internalPlan: "pro", status: "active" })).toBe("pro");
    expect(resolveInternalPlan({ internalPlan: "pro" })).toBe("pro");
    expect(resolveInternalPlan({ internalPlan: "growth", status: "active" })).toBe("growth");
  });

  it("keeps billing cadence separate from capabilities", () => {
    expect(getPlanCapabilities("pro", "monthly")).toMatchObject({ plan: "pro", billingCadence: "monthly", products: { maxProducts: 3 } });
    expect(getPlanCapabilities("pro", "annual")).toMatchObject({ plan: "pro", billingCadence: "annual", products: { maxProducts: 3 } });
    expect(getPlanCapabilities("pro", "monthly").scanProfiles).toEqual(getPlanCapabilities("pro", "annual").scanProfiles);
  });

  it("exposes the exact Free, Pro, and Growth entitlement matrix", () => {
    expect(PLAN_CAPABILITIES.free).toMatchObject({
      products: { maxProducts: 1 },
      monitoring: { enabled: false, monitoringIntervalMinutes: null, deepDiscoveryIntervalDays: null },
      manual: { manualScansPerMonth: 3 },
      history: { driftHistoryDays: 0 },
      experiments: { maxActiveExperiments: 0 },
      team: { seats: 1 },
    });
    expect(PLAN_CAPABILITIES.pro).toMatchObject({
      products: { maxProducts: 3 },
      monitoring: { enabled: true, monitoringIntervalMinutes: 360, targetCyclesPerDay: 4, deepDiscoveryIntervalDays: 7 },
      manual: { manualScansPerMonth: 30 },
      history: { driftHistoryDays: 30 },
      experiments: { maxActiveExperiments: 2 },
      team: { seats: 1 },
    });
    expect(PLAN_CAPABILITIES.growth).toMatchObject({
      products: { maxProducts: 10 },
      monitoring: { enabled: true, monitoringIntervalMinutes: 120, targetCyclesPerDay: 12, deepDiscoveryIntervalDays: 3 },
      manual: { manualScansPerMonth: 100 },
      history: { driftHistoryDays: 90 },
      experiments: { maxActiveExperiments: 10 },
      team: { seats: 3 },
    });
  });

  it("resolves the onboarding, manual, monitoring, and deep budgets centrally", () => {
    expect(getScanBudget(PLAN_CAPABILITIES.free, "onboarding")).toMatchObject({ maxSourcesPerScan: 4, maxQueriesPerScan: 6, maxCandidatesPerScan: 30, maxLlmEvaluationsPerScan: 20 });
    expect(getScanBudget(PLAN_CAPABILITIES.free, "manual_standard")).toMatchObject({ maxSourcesPerScan: 3, maxQueriesPerScan: 4, maxCandidatesPerScan: 20, maxLlmEvaluationsPerScan: 15 });
    expect(getScanBudget(PLAN_CAPABILITIES.pro, "monitoring")).toMatchObject({ maxSourcesPerScan: 4, maxQueriesPerScan: 5, maxCandidatesPerScan: 30, maxLlmEvaluationsPerScan: 20 });
    expect(getScanBudget(PLAN_CAPABILITIES.pro, "scheduled_deep_discovery")).toMatchObject({ maxSourcesPerScan: 6, maxQueriesPerScan: 10, maxCandidatesPerScan: 60, maxLlmEvaluationsPerScan: 40 });
    expect(getScanBudget(PLAN_CAPABILITIES.growth, "monitoring")).toMatchObject({ maxSourcesPerScan: 6, maxQueriesPerScan: 8, maxCandidatesPerScan: 50, maxLlmEvaluationsPerScan: 35 });
    expect(getScanBudget(PLAN_CAPABILITIES.growth, "scheduled_deep_discovery")).toMatchObject({ maxSourcesPerScan: 8, maxQueriesPerScan: 12, maxCandidatesPerScan: 100, maxLlmEvaluationsPerScan: 70 });
    expect(scanProfileForMode("manual")).toBe("manual_standard");
    expect(scanProfileForMode("deep_refresh")).toBe("scheduled_deep_discovery");
  });

  it("keeps X and YouTube provider guardrails bounded", () => {
    const x = getProviderBudget(PLAN_CAPABILITIES.growth, "x", "monitoring");
    const youtube = getProviderBudget(PLAN_CAPABILITIES.growth, "youtube", "monitoring");
    expect(x).toMatchObject({ costClass: "paid_request", maxQueriesPerCycle: 2, maxPagesPerQuery: 1, maxCandidatesPerCycle: 20 });
    expect(youtube).toMatchObject({ costClass: "quota_sensitive", maxQueriesPerCycle: 1, maxVideosPerQuery: 3, maxCommentThreadsPerCycle: 3, maxCommentsPerCycle: 15 });
    expect(getProviderBudget(PLAN_CAPABILITIES.growth, "youtube", "scheduled_deep_discovery").maxQueriesPerCycle).toBeLessThanOrEqual(2);
  });
});
