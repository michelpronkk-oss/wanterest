import { describe, expect, it } from "vitest";

import { completedDashboardScanStages, dashboardScanLabel, dashboardScanStateFromProgress, isManualScanKey, isOnboardingScanKey } from "../../src/components/dashboard/scan-status.view-model";
import { scanCoverageCopy, scanResultDestination, scanStatusLabel } from "../../src/components/dashboard/scan-progress.view-model";
import { scanResultEmptyBody } from "../../src/components/dashboard/scan-status.view-model";

describe("dashboard scan status view model", () => {
  it("maps persisted lifecycle stages to user-facing copy", () => {
    expect(dashboardScanLabel("queued", "queued", false)).toBe("Preparing your first scan");
    expect(dashboardScanLabel("planning", "planning", false)).toBe("Preparing your first scan");
    expect(dashboardScanLabel("discovering", "discovering", false)).toBe("Finding relevant conversations");
    expect(dashboardScanLabel("processing", "processing", false)).toBe("Qualifying real demand");
    expect(dashboardScanLabel("building_intelligence", "building_intelligence", false)).toBe("Building your demand map");
    expect(dashboardScanLabel("generating_actions", "generating_actions", false)).toBe("Preparing recommended actions");
  });

  it("uses the manual rescan copy without changing persisted stage semantics", () => {
    expect(dashboardScanLabel("discovering", "discovering", true)).toBe("Refreshing market intelligence");
    expect(isManualScanKey("manual-scan:workspace:product:123")).toBe(true);
    expect(isManualScanKey("initial-scan:workspace:product")).toBe(false);
  });

  it("counts completed lifecycle stages from the persisted stage", () => {
    expect(completedDashboardScanStages("queued", "queued")).toBe(0);
    expect(completedDashboardScanStages("discovering", "discovering")).toBe(2);
    expect(completedDashboardScanStages("building_intelligence", "building_intelligence")).toBe(4);
    expect(completedDashboardScanStages("completed", "completed")).toBe(6);
  });

  it("keeps the rescan modal copy aligned with the persisted lifecycle", () => {
    expect(scanStatusLabel("discovering")).toBe("Finding relevant conversations…");
    expect(scanStatusLabel("processing")).toBe("Qualifying real demand…");
    expect(scanStatusLabel("building_intelligence")).toBe("Building your demand map…");
    expect(scanStatusLabel("discovering", true)).toBe("Refreshing market intelligence…");
    expect(scanStatusLabel("completed")).toBe("Your first scan is ready");
  });

  it("maps a narrow persisted poll to a local dashboard state without page refresh semantics", () => {
    const running = dashboardScanStateFromProgress({
      jobRunId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "initial-scan:workspace:product",
      status: "running",
      progress: {
        stage: "discovering",
        percent: 40,
        completedSources: 1,
        totalSources: 3,
        currentLabel: "Finding conversations",
        warnings: [],
      },
      errorMessage: null,
    });
    expect(running).toMatchObject({ kind: "running", completedStages: 2, jobRunId: "00000000-0000-4000-8000-000000000001" });

    expect(dashboardScanStateFromProgress({
      jobRunId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "initial-scan:workspace:product",
      status: "failed",
      progress: { stage: "failed", percent: 65, completedSources: 1, totalSources: 3, currentLabel: "Failed", warnings: [] },
      errorMessage: "The scan failed.",
    })).toMatchObject({ kind: "failed", message: "The scan failed." });
  });

  it("keeps a zero-qualified scan explicit instead of treating it as an empty unknown state", () => {
    expect(dashboardScanStateFromProgress({
      jobRunId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "manual-scan:workspace:product:1",
      status: "succeeded",
      progress: { stage: "partial_failure", percent: 100, completedSources: 3, totalSources: 3, currentLabel: "Complete", warnings: [] },
      errorMessage: null,
      result: { rawItems: 8, normalizedItems: 8, conversations: 8, analyses: 8, evaluations: 8, rankings: 0, signals: 0, sources: ["github", "hacker-news", "x"], mapUpdated: 0, gapUpdated: 0, driftUpdated: 0, actionsUpdated: 0, qualification: { candidateCount: 8, qualifiedCount: 0, highConfidenceCount: 0, weakCount: 2, rejectedCount: 6 } },
    })).toMatchObject({ kind: "partial_failure", summary: { signals: 0, conversations: 8 } });
  });

  it("chooses the completion CTA from persisted outputs, without exposing coverage scores", () => {
    const noSignals = { rawItems: 8, normalizedItems: 8, conversations: 8, analyses: 8, evaluations: 8, rankings: 0, signals: 0, sources: ["github", "hacker-news", "x"], mapUpdated: 0, gapUpdated: 0, driftUpdated: 0, actionsUpdated: 0 };
    const withSignals = { ...noSignals, signals: 1 };
    const withMap = { ...noSignals, mapUpdated: 3, qualification: { candidateCount: 8, qualifiedCount: 1, highConfidenceCount: 0, weakCount: 0, rejectedCount: 7 } };
    expect(scanResultDestination(noSignals)).toBeNull();
    expect(scanResultDestination(withSignals)).toBe("/app/signals");
    expect(scanResultDestination(withMap)).toBe("/app/insights/map");
    expect(scanCoverageCopy(noSignals, true)).toBe("3 sources scanned · Limited coverage");
  });

  it("uses canonical Source Health V1 copy for new scan coverage", () => {
    const result = {
      rawItems: 8,
      normalizedItems: 8,
      conversations: 8,
      analyses: 8,
      evaluations: 8,
      rankings: 0,
      signals: 0,
      sources: ["github", "hacker-news", "x"],
      mapUpdated: 0,
      gapUpdated: 0,
      driftUpdated: 0,
      actionsUpdated: 0,
      sourceHealthV1: {
        version: "source_health_v1" as const,
        sources: {},
        coverage: { score: 0.4, label: "severely_degraded" as const, plannedSourceCount: 2, healthySourceCount: 0, degradedSourceCount: 0, unavailableSourceCount: 2, copy: "Major source coverage was unavailable for this scan." },
      },
    };
    expect(scanCoverageCopy(result, true)).toBe("Major source coverage was unavailable for this scan.");
  });

  it("uses canonical coverage state to surface degraded scans while keeping full coverage complete", () => {
    const base = { rawItems: 0, normalizedItems: 0, conversations: 0, analyses: 0, evaluations: 0, rankings: 0, signals: 0, sources: ["github"], mapUpdated: 0, gapUpdated: 0, driftUpdated: 0, actionsUpdated: 0 };
    const sourceHealth = (label: "full_coverage" | "limited_coverage") => ({ version: "source_health_v1" as const, sources: {}, coverage: { score: label === "full_coverage" ? 1 : 0.5, label, plannedSourceCount: 1, healthySourceCount: label === "full_coverage" ? 1 : 0, degradedSourceCount: label === "full_coverage" ? 0 : 1, unavailableSourceCount: 0, copy: label === "full_coverage" ? "All planned sources completed successfully." : "Some planned sources were unavailable or only partially completed." } });
    const degraded = dashboardScanStateFromProgress({ jobRunId: "00000000-0000-4000-8000-000000000001", idempotencyKey: "manual-scan:workspace:product:1", status: "succeeded", progress: { stage: "completed", percent: 100, completedSources: 1, totalSources: 1, currentLabel: "Complete", warnings: [] }, errorMessage: null, result: { ...base, sourceHealthV1: sourceHealth("limited_coverage") } });
    const complete = dashboardScanStateFromProgress({ jobRunId: "00000000-0000-4000-8000-000000000002", idempotencyKey: "manual-scan:workspace:product:2", status: "succeeded", progress: { stage: "completed", percent: 100, completedSources: 1, totalSources: 1, currentLabel: "Complete", warnings: [] }, errorMessage: null, result: { ...base, sourceHealthV1: sourceHealth("full_coverage") } });
    expect(degraded.kind).toBe("partial_failure");
    expect(complete.kind).toBe("completed_no_signals");
  });

  it("only classifies the deterministic onboarding job key as the first scan", () => {
    expect(isOnboardingScanKey("initial-scan:workspace:product")).toBe(true);
    expect(isOnboardingScanKey("manual-scan:workspace:product:123")).toBe(false);
    expect(isOnboardingScanKey("monitoring:workspace:product:2026-09-23")).toBe(false);
  });

  it("marks a failed onboarding job as the first-scan case, routable to setup", () => {
    const failedOnboarding = dashboardScanStateFromProgress({
      jobRunId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "initial-scan:workspace:product",
      status: "failed",
      progress: null,
      errorMessage: "The scan failed.",
    });
    expect(failedOnboarding).toMatchObject({ kind: "failed", firstScan: true });
  });

  it("marks a failed later (manual/monitoring) job as NOT the first scan, even though onboarding once ran", () => {
    // getLatestScanState only ever returns the single most-recent job_runs row
    // across every scan mode, so a failed manual/monitoring job here means an
    // onboarding job already succeeded (or never ran) and must never route into
    // the /app/setup/scan wizard.
    const failedManual = dashboardScanStateFromProgress({
      jobRunId: "00000000-0000-4000-8000-000000000002",
      idempotencyKey: "manual-scan:workspace:product:456",
      status: "failed_terminal",
      progress: null,
      errorMessage: "The scan failed.",
    });
    expect(failedManual).toMatchObject({ kind: "failed", firstScan: false });

    const failedMonitoring = dashboardScanStateFromProgress({
      jobRunId: "00000000-0000-4000-8000-000000000003",
      idempotencyKey: "monitoring:workspace:product:2026-09-23",
      status: "cancelled",
      progress: null,
      errorMessage: null,
    });
    expect(failedMonitoring).toMatchObject({ kind: "failed", firstScan: false });
  });

  it("describes weak and rejected candidates accurately", () => {
    expect(scanResultEmptyBody({
      rawItems: 8,
      normalizedItems: 8,
      conversations: 8,
      analyses: 8,
      evaluations: 8,
      rankings: 0,
      signals: 0,
      sources: ["github", "hacker-news", "x"],
      mapUpdated: 0,
      gapUpdated: 0,
      driftUpdated: 0,
      actionsUpdated: 0,
      qualification: { candidateCount: 8, qualifiedCount: 0, highConfidenceCount: 0, weakCount: 2, rejectedCount: 6 },
    })).toContain("8 did not meet the current threshold");
  });
});
