import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../src/server/providers/trigger/client", () => ({
  inspectTriggerRun: vi.fn(),
}));

import type { JobRunRow } from "../../src/server/db/database.helpers";
import { reconcileProductDemandScanJob, DISPATCH_GRACE_MS } from "../../src/server/modules/operations/product-demand-scan.recovery";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const baseTime = Date.parse("2026-09-21T17:00:00.000Z");

const baseJob = {
  id: "00000000-0000-4000-8000-000000000003",
  job_type: "discover-source",
  workspace_id: workspaceId,
  product_id: productId,
  idempotency_key: "manual-scan:test",
  input_reference: { scanMode: "manual", progress: { stage: "queued", percent: 0, completedSources: 0, totalSources: 0, currentLabel: "Queued", warnings: [] } },
  status: "running",
  attempt_count: 0,
  started_at: new Date(baseTime).toISOString(),
  completed_at: null,
  terminal_at: null,
  retry_after_at: null,
  error_code: null,
  error_details: null,
  created_at: new Date(baseTime).toISOString(),
  updated_at: new Date(baseTime).toISOString(),
  trace_id: "trace",
  trigger_run_id: null,
  dispatch_status: "unclaimed",
  dispatch_claimed_at: new Date(baseTime).toISOString(),
  dispatch_checked_at: null,
} as JobRunRow;

function fakeClient(job: JobRunRow) {
  return {
    from: () => {
      let pendingUpdate: Partial<JobRunRow> = {};
      const chain = {
        update: (values: Partial<JobRunRow>) => {
          pendingUpdate = values;
          return chain;
        },
        eq: () => chain,
        in: () => chain,
        select: () => chain,
        maybeSingle: async () => ({ data: { ...job, ...pendingUpdate }, error: null }),
      };
      return chain;
    },
  } as never;
}

describe("durable product-demand scan recovery", () => {
  it("recovers a claim that never linked a Trigger run after the dispatch grace window", async () => {
    const result = await reconcileProductDemandScanJob(fakeClient({ ...baseJob }), { ...baseJob, status: "running" }, { now: baseTime + DISPATCH_GRACE_MS + 1 });

    expect(result.action).toBe("recovered");
    expect(result.reason).toBe("dispatch-claim-expired");
    expect(result.job.status).toBe("failed_terminal");
    expect(result.job.dispatch_status).toBe("orphaned");
    expect(result.job.error_code).toBe("TRIGGER_DISPATCH_ORPHANED");
  });

  it("keeps an uncertain claimed dispatch retryable under the same idempotency key", async () => {
    const job = { ...baseJob, dispatch_status: "claimed" };
    const result = await reconcileProductDemandScanJob(fakeClient(job), job, { now: baseTime + DISPATCH_GRACE_MS + 1 });

    expect(result.action).toBe("waiting");
    expect(result.reason).toBe("dispatch-link-uncertain");
    expect(result.job.status).toBe("running");
  });

  it("recovers a linked job when the provider proves the run expired", async () => {
    const job = { ...baseJob, trigger_run_id: "run_expired", dispatch_status: "linked", dispatch_checked_at: null };
    const result = await reconcileProductDemandScanJob(fakeClient(job), job, {
      now: baseTime + DISPATCH_GRACE_MS + 1,
      inspect: async () => ({ state: "terminal", status: "EXPIRED" }),
    });

    expect(result.action).toBe("recovered");
    expect(result.reason).toBe("EXPIRED");
    expect(result.job.status).toBe("failed_terminal");
    expect(result.job.error_code).toBe("TRIGGER_RUN_EXPIRED");
  });

  it("keeps a provider run active and records the status-check timestamp", async () => {
    const job = { ...baseJob, trigger_run_id: "run_active", dispatch_status: "linked", dispatch_checked_at: null };
    const result = await reconcileProductDemandScanJob(fakeClient(job), job, {
      now: baseTime + DISPATCH_GRACE_MS + 1,
      inspect: async () => ({ state: "active", status: "EXECUTING" }),
    });

    expect(result.action).toBe("active");
    expect(result.reason).toBe("EXECUTING");
    expect(result.job.dispatch_status).toBe("linked");
  });

  it("does not orphan direct execution while it is running", async () => {
    const job = { ...baseJob, dispatch_status: "not_applicable" };
    const result = await reconcileProductDemandScanJob(fakeClient(job), job, { now: baseTime + DISPATCH_GRACE_MS + 1 });

    expect(result.action).toBe("active");
  });
});
