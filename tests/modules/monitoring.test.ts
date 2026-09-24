import { describe, expect, it } from "vitest";

import { demandDriftWindowAllowed, MONITORING_POLICY_VERSION, monitoringPolicySnapshot, type MonitoringPolicy } from "../../src/server/modules/entitlements/monitoring-policy.contract";
import { nextMonitoringCycleAt, nextMonitoringDeepRefreshAt } from "../../src/server/modules/monitoring/monitoring.schedule";
import { deriveMonitoringStatus } from "../../src/server/modules/monitoring/monitoring.view-model";
import { scanModeSchema } from "../../src/server/modules/operations/product-demand-scan.schemas";
import { scheduledScanIdempotencyKey, shouldRefreshDerivedIntelligence } from "../../src/server/modules/operations/product-demand-scan.identity";

const policy: MonitoringPolicy = {
  version: MONITORING_POLICY_VERSION,
  monitoringEnabled: true,
  intelligenceCyclesPerDay: 4,
  intelligenceCycleIntervalMinutes: 360,
  deepRefreshesPerWeek: 1,
  manualRefreshCooldownMinutes: 180,
  intelligenceCycleMaxSources: 3,
  intelligenceCycleQueryBudget: 8,
  intelligenceCycleCandidateBudget: 18,
  deepRefreshMaxSources: 4,
  deepRefreshQueryBudget: 12,
  deepRefreshCandidateBudget: 30,
  xMaxRequestsPerCycle: 1,
  xMaxBillablePostsPerCycle: 10,
  xMaxRequestsPerDeepRefresh: 2,
  xMaxBillablePostsPerDeepRefresh: 20,
  xDailyBudgetUsd: 0.5,
  digestEnabled: true,
  priorityAlertsEnabled: false,
  demandDriftDays: 30,
};

describe("Automatic Monitoring v1 policy contracts", () => {
  it("keeps the monitoring policy snapshot JSON-safe and versioned", () => {
    expect(monitoringPolicySnapshot(policy)).toMatchObject({ version: "automatic-monitoring-v1", intelligenceCyclesPerDay: 4, xDailyBudgetUsd: 0.5 });
  });

  it("enforces plan-backed drift history windows", () => {
    expect(demandDriftWindowAllowed(policy, 30)).toBe(true);
    expect(demandDriftWindowAllowed(policy, 90)).toBe(false);
    expect(demandDriftWindowAllowed({ ...policy, demandDriftDays: 0 }, 7)).toBe(false);
  });

  it("accepts the explicit monitoring scan modes and creates stable slots", () => {
    expect(scanModeSchema.parse("monitoring")).toBe("monitoring");
    expect(scanModeSchema.parse("intelligence_cycle")).toBe("intelligence_cycle");
    expect(scanModeSchema.parse("deep_refresh")).toBe("deep_refresh");
    expect(scheduledScanIdempotencyKey("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "monitoring", "2026-09-22T12:00:00.000Z")).toContain("monitoring:");
    expect(scheduledScanIdempotencyKey("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "intelligence_cycle", "2026-09-22T12:00:00.000Z")).toContain("intelligence_cycle:");
  });

  it("keeps recurring monitoring lightweight when qualification finds no new signal", () => {
    expect(shouldRefreshDerivedIntelligence("monitoring", 0)).toBe(false);
    expect(shouldRefreshDerivedIntelligence("monitoring", 1)).toBe(true);
    expect(shouldRefreshDerivedIntelligence("manual", 0)).toBe(true);
  });

  it("maps persisted monitoring state to the small dashboard status contract", () => {
    expect(deriveMonitoringStatus({ enabled: false, policyEnabled: false })).toBe("paused");
    expect(deriveMonitoringStatus({ enabled: true, policyEnabled: true, currentStatus: "failed" })).toBe("failed");
    expect(deriveMonitoringStatus({ enabled: true, policyEnabled: true, resultState: "complete_with_warnings" })).toBe("limited");
    expect(deriveMonitoringStatus({ enabled: true, policyEnabled: true, currentStatus: "completed" })).toBe("healthy");
    expect(deriveMonitoringStatus({ enabled: true, policyEnabled: true, sourceHealthLabel: "limited_coverage" })).toBe("limited");
    expect(deriveMonitoringStatus({ enabled: true, policyEnabled: true, sourceHealthLabel: "severely_degraded" })).toBe("failed");
    expect(deriveMonitoringStatus({ enabled: true, policyEnabled: true, resultState: "complete_with_warnings", sourceHealthLabel: "full_coverage" })).toBe("healthy");
  });

  it("recomputes future cadence from the current policy and disables recurring work for Free", () => {
    const productId = "00000000-0000-4000-8000-000000000002";
    const now = "2026-09-22T00:00:00.000Z";
    const pro = { ...policy, intelligenceCyclesPerDay: 4, intelligenceCycleIntervalMinutes: 360, deepRefreshesPerWeek: 1 };
    const growth = { ...policy, intelligenceCyclesPerDay: 12, intelligenceCycleIntervalMinutes: 120, deepRefreshesPerWeek: 3 };
    const free = { ...policy, monitoringEnabled: false, intelligenceCyclesPerDay: 0, intelligenceCycleIntervalMinutes: 0, deepRefreshesPerWeek: 0 };

    expect(Date.parse(nextMonitoringCycleAt(now, growth, productId)!) - Date.parse(nextMonitoringCycleAt(now, pro, productId)!)).toBe(-240 * 60_000);
    expect(Date.parse(nextMonitoringDeepRefreshAt(now, growth, productId)!) - Date.parse(nextMonitoringDeepRefreshAt(now, pro, productId)!)).toBe(-6_720 * 60_000);
    expect(nextMonitoringCycleAt(now, free, productId)).toBeNull();
    expect(nextMonitoringDeepRefreshAt(now, free, productId)).toBeNull();
  });
});
