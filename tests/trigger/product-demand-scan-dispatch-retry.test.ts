import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Regression test for the dispatch deadlock: a forced retry (forceRebuild) of a
// terminal "failed"/"failed_terminal" job could never re-claim the row, because
// claimProductDemandScanDispatch only ever claimed from "pending". attachTriggerRun
// and markProductDemandScanDispatchPersistenceFailure both require status "running"
// before they can persist anything, so every retry dispatched a new Trigger.dev run
// yet always reported the generic "could not be linked" failure back to the user.

type RecordedCall = { update?: Record<string, unknown>; eq: Array<[string, unknown]>; is: Array<[string, unknown]> };

let recorded: RecordedCall;
let nextResult: { data: { id: string } | null; error: null };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  builder.update = (value: Record<string, unknown>) => {
    recorded.update = value;
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    recorded.eq.push([column, value]);
    return builder;
  };
  builder.is = (column: string, value: unknown) => {
    recorded.is.push([column, value]);
    return builder;
  };
  builder.select = () => builder;
  builder.maybeSingle = async () => nextResult;
  return builder;
}

vi.mock("@/server/providers/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ from: () => makeBuilder() }),
}));

const { claimProductDemandScanDispatch } = await import("../../src/server/modules/operations/product-demand-scan.service");

describe("claimProductDemandScanDispatch retry claim", () => {
  beforeEach(() => {
    recorded = { eq: [], is: [] };
    nextResult = { data: { id: "job-1" }, error: null };
  });

  it("claims a normal pending job and still requires no prior trigger_run_id", async () => {
    const claimed = await claimProductDemandScanDispatch("job-1");
    expect(claimed).toBe(true);
    expect(recorded.eq).toContainEqual(["status", "pending"]);
    expect(recorded.is).toContainEqual(["trigger_run_id", null]);
    expect(recorded.update).toMatchObject({ status: "running", dispatch_status: "claimed" });
    expect(recorded.update).not.toHaveProperty("trigger_run_id");
  });

  it("claims from 'failed' on a forced retry, resetting the prior terminal state to running", async () => {
    const claimed = await claimProductDemandScanDispatch("job-1", "failed");
    expect(claimed).toBe(true);
    expect(recorded.eq).toContainEqual(["status", "failed"]);
    // A retry must not require the stale linked run to already be null: it clears it instead.
    expect(recorded.is).toEqual([]);
    expect(recorded.update).toMatchObject({
      status: "running",
      dispatch_status: "claimed",
      trigger_run_id: null,
      error_code: null,
      error_details: null,
      completed_at: null,
      terminal_at: null,
    });
  });

  it("claims from 'failed_terminal' the same way as 'failed'", async () => {
    const claimed = await claimProductDemandScanDispatch("job-1", "failed_terminal");
    expect(claimed).toBe(true);
    expect(recorded.eq).toContainEqual(["status", "failed_terminal"]);
    expect(recorded.update).toMatchObject({ status: "running", trigger_run_id: null });
  });

  it("returns false without throwing when the row was already claimed elsewhere", async () => {
    nextResult = { data: null, error: null };
    const claimed = await claimProductDemandScanDispatch("job-1", "failed");
    expect(claimed).toBe(false);
  });
});
