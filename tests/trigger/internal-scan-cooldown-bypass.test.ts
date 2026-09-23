import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression coverage for the TEMPORARY internal cooldown bypass (internal-scan-bypass.ts):
// INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS lets a short, env-configured allowlist of
// Wanterest-owned workspaces skip ONLY the manual refresh cooldown while iterating on signal
// relevance. Every other gate (usage limits, entitlements, authorization, source budgets) —
// and every other workspace, including Free's 1440-minute cooldown — must stay exactly as
// before. This mirrors product-demand-scan-cooldown.test.ts's harness so the two suites stay
// consistent, and adds only the bypass-specific assertions.

const bypassWorkspaceId = "8b7a4189-54b7-4cc0-a4a3-1502dc2be82a";
const normalWorkspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

const productRow = { id: productId, workspace_id: bypassWorkspaceId, status: "active" };

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

// Free plan cooldown, matching production (monitoring-policy.ts: free === 1440 minutes).
vi.mock("@/server/modules/entitlements/monitoring-policy", () => ({
  resolveMonitoringPolicy: async () => ({ manualRefreshCooldownMinutes: 1440 }),
}));

const consumeUsage = vi.fn(async () => ({ id: "usage-1" }));
let manualScansLimit: number | null = 3;
let manualScansUsed = 0;

vi.mock("@/server/modules/entitlements/entitlement.repository", () => ({
  getWorkspaceEntitlement: async (_client: unknown, _workspaceId: string, capability: string) => {
    if (capability === "scan_frequency") return { row: null, value: 30 };
    if (capability === "manual_scans_monthly") return { row: null, value: manualScansLimit };
    return { row: null, value: null };
  },
  getUsageTotals: async () => (manualScansUsed > 0 ? [{ usage_type: "manual_scan", amount: manualScansUsed }] : []),
  consumeUsage,
}));

vi.mock("../../src/server/modules/onboarding/initial-scan.service", () => ({
  runInitialScan: vi.fn(),
  scanJobKey: () => "stub-key",
}));

const { prepareProductDemandScan } = await import("../../src/server/modules/operations/product-demand-scan.service");

let jobRunsQueue: Array<{ data: unknown; error: unknown }> = [];
let keySeq = 0;

function freshInput(workspaceId: string, overrides: Partial<Record<string, unknown>> = {}) {
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

function recentSucceededManualScan(ageMinutes: number) {
  return {
    id: `job-recent-${ageMinutes}`,
    idempotency_key: `manual-scan:prior`,
    status: "succeeded",
    created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    input_reference: { scanMode: "manual" },
  };
}

function queueLookup(input: { existing?: unknown; active?: unknown[]; recent?: unknown[]; created?: unknown }) {
  jobRunsQueue = [
    { data: input.existing ?? null, error: null }, // existingResult (by idempotency_key)
    { data: input.active ?? [], error: null }, // active pending/running lookup
    // The "recent" cooldown-history query is only issued when the cooldown check actually
    // runs. When bypassed, the very next job_runs query is the insert — queuing a "recent"
    // slot unconditionally here would silently consume that insert's response instead.
    ...(input.recent !== undefined ? [{ data: input.recent, error: null }] : []),
    ...(input.created !== undefined ? [{ data: input.created, error: null }] : []),
  ];
}

describe("internal scan cooldown bypass", () => {
  beforeEach(() => {
    manualScansLimit = 3;
    manualScansUsed = 0;
    consumeUsage.mockClear();
    // The bypass check calls the real getServerEnv(), which requires these regardless of
    // whether they're actually used by anything else in this mocked test harness.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("A: a normal Free workspace is still blocked by the 1440-minute cooldown", async () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", bypassWorkspaceId);
    const input = freshInput(normalWorkspaceId);
    queueLookup({ recent: [recentSucceededManualScan(1)] });

    await expect(prepareProductDemandScan(input)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Refresh intelligence is available again soon.",
    });
  });

  it("B: the configured internal bypass workspace skips the cooldown entirely", async () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", bypassWorkspaceId);
    const input = freshInput(bypassWorkspaceId);
    // Only existing/active/insert are queued — no "recent" cooldown-history lookup should
    // ever be issued when bypassed. If the code regressed and queried it anyway, the insert
    // response below would be consumed by that stray query instead and this would fail.
    queueLookup({ created: { id: "new-job", idempotency_key: input.idempotencyKey, status: "pending" } });

    const prepared = await prepareProductDemandScan(input);
    expect(prepared.shouldTrigger).toBe(true);
    expect(prepared.job.status).toBe("pending");
  });

  it("C: the bypass workspace still enforces the monthly manual scan usage limit", async () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", bypassWorkspaceId);
    manualScansLimit = 3;
    manualScansUsed = 3;
    const input = freshInput(bypassWorkspaceId);
    queueLookup({});

    await expect(prepareProductDemandScan(input)).rejects.toMatchObject({ code: "USAGE_LIMIT_EXCEEDED" });
  });

  it("D: a missing/empty env value means no bypass, even for the workspace ID that would otherwise match", async () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", "");
    const input = freshInput(bypassWorkspaceId);
    queueLookup({ recent: [recentSucceededManualScan(1)] });

    await expect(prepareProductDemandScan(input)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("E: a different workspace not in the allowlist is not bypassed", async () => {
    vi.stubEnv("INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS", bypassWorkspaceId);
    const input = freshInput(normalWorkspaceId);
    queueLookup({ recent: [recentSucceededManualScan(1)] });

    await expect(prepareProductDemandScan(input)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
