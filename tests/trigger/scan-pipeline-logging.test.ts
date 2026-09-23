import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression coverage for the "stuck at 0/6" debugging request: a scan can dispatch
// successfully (a real trigger_run_id gets linked) yet the task never advances past its
// initial "queued" progress, with nothing to tell whether the task started executing at
// all, which step it was on, or whether a progress write ever landed. These tests pin the
// exact [scan] log taxonomy requested so the next occurrence is diagnosable from
// Trigger.dev's own log viewer instead of only job_runs' final resting state.

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const productRow = { id: productId, workspace_id: workspaceId, status: "active" };

const jobRunId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "manual-scan:test";
const trustedJobRow = {
  id: jobRunId,
  job_type: "discover-source",
  workspace_id: workspaceId,
  product_id: productId,
  idempotency_key: idempotencyKey,
  input_reference: { requestedByUserId: userId },
};

function makeAuthorizationClient() {
  return {
    from: (table: string) => {
      if (table === "workspace_members") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "member-1" }, error: null }) }) }) }) }) };
      if (table === "products") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: productRow, error: null }) }) }) }) };
      if (table === "job_runs") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: trustedJobRow, error: null }) }) }) };
      throw new Error(`unexpected table in test fake: ${table}`);
    },
  };
}

const { runInitialScan } = vi.hoisted(() => ({ runInitialScan: vi.fn() }));

vi.mock("@/server/providers/supabase/service", () => ({
  createSupabaseServiceClient: () => makeAuthorizationClient(),
  createSupabaseBillingServiceClient: () => makeAuthorizationClient(),
}));
vi.mock("@/server/modules/entitlements/entitlement.repository", () => ({
  getWorkspaceEntitlement: async () => ({ row: null, value: 30 }),
  consumeUsage: async () => ({ id: "usage-1" }),
  getUsageTotals: async () => [],
}));
vi.mock("../../src/server/modules/onboarding/initial-scan.service", () => ({
  runInitialScan,
  scanJobKey: () => "stub-key",
}));

const { executeProductDemandScan } = await import("../../src/server/modules/operations/product-demand-scan.service");

function makeJobRunsClient(response: { error: unknown }) {
  return {
    from: (table: string) => {
      if (table !== "job_runs") throw new Error(`unexpected table in test fake: ${table}`);
      return { update: () => ({ eq: async () => response }) };
    },
  };
}

describe("setScanJob logging", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it("logs step-started then progress-persisted, in order, around a successful write", async () => {
    // initial-scan.service is mocked above (for the executeProductDemandScan tests below),
    // so setScanJob itself must be reached through the real, unmocked module directly.
    const actual = await vi.importActual<typeof import("../../src/server/modules/onboarding/initial-scan.service")>(
      "../../src/server/modules/onboarding/initial-scan.service",
    );
    const client = makeJobRunsClient({ error: null }) as never;

    await actual.setScanJob(client, "job-1", { status: "running", phase: "planning", progress: { stage: "planning", percent: 25 } as never });

    const labels = consoleLog.mock.calls.map(([label]) => label);
    expect(labels).toEqual(["[scan] step started", "[scan] progress persisted"]);
    expect(consoleLog.mock.calls[0]?.[1]).toMatchObject({ jobId: "job-1", phase: "planning", stage: "planning", percent: 25 });
    expect(consoleLog.mock.calls[1]?.[1]).toMatchObject({ jobId: "job-1", phase: "planning", status: "running", stage: "planning", percent: 25 });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs [scan] failed and never logs progress-persisted when the write itself fails", async () => {
    const actual = await vi.importActual<typeof import("../../src/server/modules/onboarding/initial-scan.service")>(
      "../../src/server/modules/onboarding/initial-scan.service",
    );
    const client = makeJobRunsClient({ error: { message: "connection reset" } }) as never;

    await expect(actual.setScanJob(client, "job-2", { phase: "discovering", progress: { stage: "discovering", percent: 40 } as never }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    const logLabels = consoleLog.mock.calls.map(([label]) => label);
    expect(logLabels).toEqual(["[scan] step started"]);
    expect(logLabels).not.toContain("[scan] progress persisted");
    expect(consoleError).toHaveBeenCalledWith("[scan] failed", expect.objectContaining({ jobId: "job-2", phase: "discovering", reason: "progress_persist_failed" }));
  });
});

describe("executeProductDemandScan start/failure logging", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runInitialScan.mockReset();
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it("logs [scan] started with jobId and triggerRunId before any pipeline work, proving the task actually began executing", async () => {
    runInitialScan.mockResolvedValueOnce({ evaluations: 0, signals: 0, newSignals: 0, sourceResults: [] });

    await executeProductDemandScan({
      workspaceId,
      productId,
      requestedByUserId: userId,
      scanMode: "manual",
      idempotencyKey: "manual-scan:test",
      forceRebuild: false,
      jobRunId: "11111111-1111-4111-8111-111111111111",
    }, "run_abc123");

    const startCall = consoleLog.mock.calls.find(([label]) => label === "[scan] started");
    expect(startCall?.[1]).toMatchObject({ jobId: "11111111-1111-4111-8111-111111111111", triggerRunId: "run_abc123", workspaceId, productId, scanMode: "manual" });
  });

  it("logs [scan] failed with the jobId/triggerRunId/error details when the pipeline throws", async () => {
    runInitialScan.mockRejectedValueOnce(new Error("No usable source results were available for the first scan."));

    await expect(executeProductDemandScan({
      workspaceId,
      productId,
      requestedByUserId: userId,
      scanMode: "manual",
      idempotencyKey: "manual-scan:test",
      forceRebuild: false,
      jobRunId: "11111111-1111-4111-8111-111111111111",
    }, "run_abc123")).rejects.toThrow("No usable source results");

    expect(consoleError).toHaveBeenCalledWith("[scan] failed", expect.objectContaining({
      jobId: "11111111-1111-4111-8111-111111111111",
      triggerRunId: "run_abc123",
      errorMessage: "No usable source results were available for the first scan.",
    }));
  });
});
