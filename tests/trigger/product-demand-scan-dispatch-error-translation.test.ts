import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression test for the dashboard "Retry" bug: when the Trigger.dev SDK call in
// requestProductDemandScanCommand threw, the command re-threw that raw (non-AppError)
// SDK error unchanged. toPublicError has no way to produce a safe message for a
// non-AppError, so it always fell back to "An unexpected error occurred." with no
// code and nothing to distinguish it from any other failure. The job row was still
// correctly marked "failed" for diagnostics, but the client got nothing actionable
// and the click looked like it silently did nothing.

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

const productRow = { id: productId, workspace_id: workspaceId, status: "active" };

let jobRunsQueue: Array<{ data: unknown; error: unknown }> = [];
const updateCalls: Array<Record<string, unknown>> = [];

function makeSingleBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.maybeSingle = async () => response;
  return builder;
}

function makeJobRunsBuilder() {
  let resolved: { data: unknown; error: unknown } | null = null;
  const resolveOnce = () => {
    if (!resolved) resolved = jobRunsQueue.shift() ?? { data: null, error: null };
    return resolved;
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.insert = chain;
  builder.eq = chain;
  builder.in = chain;
  builder.is = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.update = (value: Record<string, unknown>) => {
    updateCalls.push(value);
    return builder;
  };
  builder.maybeSingle = async () => resolveOnce();
  builder.single = async () => resolveOnce();
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(resolveOnce()).then(resolve, reject);
  return builder;
}

function makeClient() {
  return {
    from: (table: string) => {
      if (table === "workspace_members") return makeSingleBuilder({ data: { id: "member-1" }, error: null });
      if (table === "products") return makeSingleBuilder({ data: productRow, error: null });
      if (table === "job_runs") return makeJobRunsBuilder();
      throw new Error(`unexpected table in test fake: ${table}`);
    },
  };
}

vi.mock("@/server/providers/supabase/service", () => ({
  createSupabaseServiceClient: () => makeClient(),
}));

vi.mock("@/server/modules/auth", () => ({
  requireUser: async () => ({ id: userId }),
}));

vi.mock("@/server/modules/products", () => ({
  getProductQuery: async () => productRow,
}));

vi.mock("@/server/modules/entitlements/monitoring-policy", () => ({
  resolveMonitoringPolicy: async () => ({ manualRefreshCooldownMinutes: 0 }),
}));

vi.mock("@/server/modules/entitlements/entitlement.repository", () => ({
  getWorkspaceEntitlement: async (_client: unknown, _workspaceId: string, capability: string) => {
    if (capability === "scan_frequency") return { row: null, value: 30 };
    if (capability === "manual_scans_monthly") return { row: null, value: null };
    return { row: null, value: null };
  },
  getUsageTotals: async () => [],
  consumeUsage: async () => ({ id: "usage-1" }),
}));

const triggerProductDemandScan = vi.fn();

vi.mock("@/server/providers/trigger/client", () => ({
  getTriggerRuntimeConfig: () => ({ executionMode: "remote", triggerConfigured: true, triggerSecretPresent: true }),
  triggerProductDemandScan: (...args: unknown[]) => triggerProductDemandScan(...args),
}));

const { requestProductDemandScanCommand } = await import("../../src/server/modules/operations/product-demand-scan.command");
const { AppError } = await import("../../src/server/lib/errors");

describe("requestProductDemandScanCommand dispatch failure translation", () => {
  beforeEach(() => {
    // manualRefreshCooldownMinutes is mocked to 0, so prepareProductDemandScan skips the
    // "recent" cooldown-history lookup entirely: existing -> active -> insert -> claim.
    jobRunsQueue = [
      { data: null, error: null }, // existingResult (by idempotency_key)
      { data: [], error: null }, // active pending/running lookup
      { data: { id: "job-1", idempotency_key: "manual-scan:stub", status: "pending" }, error: null }, // insert
      { data: { id: "job-1" }, error: null }, // claimProductDemandScanDispatch("pending")
    ];
    updateCalls.length = 0;
    triggerProductDemandScan.mockReset();
  });

  it("wraps a raw Trigger.dev SDK error in a typed AppError instead of leaking it", async () => {
    const sdkError = { name: "ApiError", status: 401, message: "Unauthorized" };
    triggerProductDemandScan.mockRejectedValueOnce(sdkError);

    const failure = await requestProductDemandScanCommand({ workspaceId, productId, scanMode: "manual" }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "SCAN_DISPATCH_FAILED", status: 502 });
    // The public message must not be the generic fallback and must not leak the raw SDK shape.
    expect((failure as InstanceType<typeof AppError>).message).toBe("The scan could not be started. Please try again.");

    // The job row is still marked failed for diagnosis/retry, independent of the client-facing wrap.
    expect(updateCalls.some((call) => call.status === "failed" && call.error_code === "TRIGGER_START_FAILED")).toBe(true);
  });
});
