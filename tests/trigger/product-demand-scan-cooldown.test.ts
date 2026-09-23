import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../src/server/providers/trigger/client", () => ({
  inspectTriggerRun: vi.fn(),
}));

// Regression tests for the manual-scan refresh-cooldown guard in
// prepareProductDemandScan (product-demand-scan.service.ts). The guard used to key
// its cooldown off the most recent manual-mode job_runs row regardless of outcome,
// so a job that had just failed counted as "recent manual activity" and blocked its
// own immediate retry with "Refresh intelligence is available again soon." The fix
// only lets a *succeeded* last attempt start/enforce the cooldown.

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

const productRow = { id: productId, workspace_id: workspaceId, status: "active" };

let jobRunsQueue: Array<{ data: unknown; error: unknown }> = [];
let cooldownMinutes = 30;
let manualScansLimit: number | null = 3;
let manualScansUsed = 0;

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

vi.mock("@/server/modules/entitlements/monitoring-policy", () => ({
  resolveMonitoringPolicy: async () => ({ manualRefreshCooldownMinutes: cooldownMinutes }),
}));

const consumeUsage = vi.fn(async () => ({ id: "usage-1" }));

vi.mock("@/server/modules/entitlements/entitlement.repository", () => ({
  getWorkspaceEntitlement: async (_client: unknown, _workspaceId: string, capability: string) => {
    if (capability === "scan_frequency") return { row: null, value: 30 };
    if (capability === "manual_scans_monthly") return { row: null, value: manualScansLimit };
    return { row: null, value: null };
  },
  getUsageTotals: async () => (manualScansUsed > 0 ? [{ usage_type: "manual_scan", amount: manualScansUsed }] : []),
  consumeUsage,
}));

const runInitialScan = vi.fn();

vi.mock("../../src/server/modules/onboarding/initial-scan.service", () => ({
  runInitialScan,
  scanJobKey: () => "stub-key",
}));

const { prepareProductDemandScan, executeProductDemandScan } = await import("../../src/server/modules/operations/product-demand-scan.service");

let keySeq = 0;
function freshInput(overrides: Partial<Record<string, unknown>> = {}) {
  keySeq += 1;
  return {
    workspaceId,
    productId,
    requestedByUserId: userId,
    scanMode: "manual" as const,
    idempotencyKey: `manual-scan:${workspaceId}:${productId}:${keySeq}`,
    forceRebuild: false,
    ...overrides,
  };
}

function queueCooldownLookup(input: { existing?: unknown; active?: unknown[]; recent?: unknown[]; created?: unknown }) {
  jobRunsQueue = [
    { data: input.existing ?? null, error: null }, // existingResult (by idempotency_key)
    { data: input.active ?? [], error: null }, // active pending/running lookup
    { data: input.recent ?? [], error: null }, // recent history for cooldown
    ...(input.created !== undefined ? [{ data: input.created, error: null }] : []),
  ];
}

function manualJob(status: string, ageMinutes: number) {
  return {
    id: `job-${status}-${ageMinutes}`,
    idempotency_key: `manual-scan:${workspaceId}:${productId}:prior`,
    status,
    created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    input_reference: { scanMode: "manual" },
  };
}

describe("prepareProductDemandScan manual refresh cooldown", () => {
  beforeEach(() => {
    cooldownMinutes = 30;
    manualScansLimit = 3;
    manualScansUsed = 0;
    consumeUsage.mockClear();
    runInitialScan.mockClear();
    // The internal cooldown-bypass check (internal-scan-bypass.ts) calls the real
    // getServerEnv(), which requires these regardless of whether this suite exercises it.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows an immediate retry when the last manual scan failed", async () => {
    const input = freshInput();
    queueCooldownLookup({ recent: [manualJob("failed", 1)], created: { id: "new-job", idempotency_key: input.idempotencyKey, status: "pending" } });

    const prepared = await prepareProductDemandScan(input);
    expect(prepared.shouldTrigger).toBe(true);
    expect(prepared.job.status).toBe("pending");
  });

  it("allows an immediate retry when the last manual scan is failed_terminal", async () => {
    const input = freshInput();
    queueCooldownLookup({ recent: [manualJob("failed_terminal", 1)], created: { id: "new-job", idempotency_key: input.idempotencyKey, status: "pending" } });

    const prepared = await prepareProductDemandScan(input);
    expect(prepared.shouldTrigger).toBe(true);
  });

  it("still enforces the cooldown after a recent successful scan", async () => {
    const input = freshInput();
    queueCooldownLookup({ recent: [manualJob("succeeded", 1)] });

    await expect(prepareProductDemandScan(input)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Refresh intelligence is available again soon.",
    });
  });

  it("does not enforce cooldown once the cooldown window has fully elapsed after a success", async () => {
    const input = freshInput();
    queueCooldownLookup({ recent: [manualJob("succeeded", 60)], created: { id: "new-job", idempotency_key: input.idempotencyKey, status: "pending" } });

    const prepared = await prepareProductDemandScan(input);
    expect(prepared.shouldTrigger).toBe(true);
  });

  it("still respects the Free plan's monthly manual scan allowance even for a post-failure retry", async () => {
    manualScansLimit = 3;
    manualScansUsed = 3;
    const input = freshInput();
    queueCooldownLookup({ recent: [manualJob("failed", 1)] });

    await expect(prepareProductDemandScan(input)).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
    });
  });

  it("does not double-consume usage when a failed attempt is retried and then succeeds", async () => {
    const first = freshInput();
    queueCooldownLookup({ recent: [], created: { id: "job-1", idempotency_key: first.idempotencyKey, status: "pending" } });
    await prepareProductDemandScan(first);

    runInitialScan.mockRejectedValueOnce(new Error("Provider dispatch failed."));
    await expect(executeProductDemandScan({ ...first, jobRunId: undefined })).rejects.toThrow("Provider dispatch failed.");
    expect(consumeUsage).not.toHaveBeenCalled();

    const retry = freshInput();
    queueCooldownLookup({ recent: [manualJob("failed", 1)], created: { id: "job-2", idempotency_key: retry.idempotencyKey, status: "pending" } });
    const prepared = await prepareProductDemandScan(retry);
    expect(prepared.shouldTrigger).toBe(true);

    runInitialScan.mockResolvedValueOnce({ evaluations: 1, signals: 1, newSignals: 1, sourceResults: [] });
    await executeProductDemandScan({ ...retry, jobRunId: undefined });

    expect(consumeUsage).toHaveBeenCalledTimes(1);
  });
});
