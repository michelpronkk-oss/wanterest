import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression tests for the stale retry-banner bug: getProductScanState previously
// classified "the most recent job of ANY scan mode is failed" as "your first scan
// couldn't finish" with a Retry link into /app/setup/scan, even when the product
// was already fully onboarded and only a later manual/monitoring scan had failed.

type ScanStateFixture = { jobRunId: string; status: string; phase: string; progress: null; result: null; errorMessage: string | null; idempotencyKey: string; completedAt: string | null } | null;

let activeScan: ScanStateFixture = null;
let latestScan: ScanStateFixture = null;

vi.mock("@/server/modules/onboarding", () => ({
  getActiveScanState: async () => activeScan,
  getLatestScanState: async () => latestScan,
}));

const { getProductScanState } = await import("../../src/components/dashboard/scan-state");

describe("getProductScanState first-scan classification", () => {
  beforeEach(() => {
    activeScan = null;
    latestScan = null;
  });

  it("classifies a failed onboarding job as the genuine first-scan-failed case", async () => {
    latestScan = { jobRunId: "job-1", status: "failed", phase: "failed", progress: null, result: null, errorMessage: "boom", idempotencyKey: "initial-scan:workspace:product", completedAt: null };

    const state = await getProductScanState("workspace", "product", false);
    expect(state).toMatchObject({ kind: "failed", firstScan: true });
  });

  it("classifies a failed later manual scan on an onboarded product as NOT the first scan", async () => {
    latestScan = { jobRunId: "job-2", status: "failed_terminal", phase: "failed", progress: null, result: null, errorMessage: "boom", idempotencyKey: "manual-scan:workspace:product:789", completedAt: null };

    // Existing qualified signals make this unambiguous, but the classification
    // must hold even when hasQualifiedSignals is false (e.g. a scan that failed
    // before qualifying anything) — it must never fall back to "first scan".
    const state = await getProductScanState("workspace", "product", true);
    expect(state).toMatchObject({ kind: "failed", firstScan: false });

    const stateWithoutSignals = await getProductScanState("workspace", "product", false);
    expect(stateWithoutSignals).toMatchObject({ kind: "failed", firstScan: false });
  });

  it("never treats an old failed onboarding job as the first scan once a later job exists", async () => {
    // getLatestScanState only ever returns the single most-recent row, so an old
    // failed onboarding row is not even the input here once a newer job exists —
    // this asserts the newer (monitoring) job's classification wins.
    latestScan = { jobRunId: "job-3", status: "cancelled", phase: "failed", progress: null, result: null, errorMessage: null, idempotencyKey: "monitoring:workspace:product:2026-09-23", completedAt: null };

    const state = await getProductScanState("workspace", "product", true);
    expect(state).toMatchObject({ kind: "failed", firstScan: false });
  });
});
