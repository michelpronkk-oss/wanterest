import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression test: usage must be charged only after the scan actually completes.
// Previously consumeUsage() ran before runInitialScan(), so a scan that failed for
// any reason (source outage, dispatch failure, no usable sources) still permanently
// burned one of the Free plan's 3 monthly manual scans. Zero qualified signals is a
// successful outcome and must still charge exactly once.

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

const productRow = { id: productId, workspace_id: workspaceId, status: "active" };

function makeClient() {
  return {
    from: (table: string) => {
      if (table === "workspace_members") {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "member-1" }, error: null }) }) }) }) }) };
      }
      if (table === "products") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: productRow, error: null }) }) }) }) };
      }
      throw new Error(`unexpected table in test fake: ${table}`);
    },
  };
}

vi.mock("@/server/providers/supabase/service", () => ({
  createSupabaseServiceClient: () => makeClient(),
  createSupabaseBillingServiceClient: () => makeClient(),
}));

const getWorkspaceEntitlement = vi.fn(async () => ({ row: null, value: 30 }));
const consumeUsage = vi.fn(async () => ({ id: "usage-1" }));
const getUsageTotals = vi.fn(async () => []);

vi.mock("@/server/modules/entitlements/entitlement.repository", () => ({
  getWorkspaceEntitlement,
  consumeUsage,
  getUsageTotals,
}));

const runInitialScan = vi.fn();

vi.mock("../../src/server/modules/onboarding/initial-scan.service", () => ({
  runInitialScan,
  scanJobKey: () => "stub-key",
}));

const { executeProductDemandScan } = await import("../../src/server/modules/operations/product-demand-scan.service");

const baseInput = {
  workspaceId,
  productId,
  requestedByUserId: userId,
  scanMode: "manual" as const,
  idempotencyKey: `manual-scan:${workspaceId}:${productId}:test`,
  forceRebuild: false,
};

describe("executeProductDemandScan usage ordering", () => {
  beforeEach(() => {
    consumeUsage.mockClear();
    runInitialScan.mockClear();
  });

  it("consumes usage exactly once after a successful scan, including zero qualified signals", async () => {
    runInitialScan.mockResolvedValueOnce({ evaluations: 0, signals: 0, newSignals: 0, sourceResults: [] });

    const result = await executeProductDemandScan(baseInput);

    expect(result.signals).toBe(0);
    expect(consumeUsage).toHaveBeenCalledTimes(1);
    expect(consumeUsage.mock.invocationCallOrder[0]).toBeGreaterThan(runInitialScan.mock.invocationCallOrder[0]);
  });

  it("does not consume usage when the scan throws before completing", async () => {
    runInitialScan.mockRejectedValueOnce(new Error("No usable source results were available for the first scan."));

    await expect(executeProductDemandScan(baseInput)).rejects.toThrow("No usable source results");
    expect(consumeUsage).not.toHaveBeenCalled();
  });
});
