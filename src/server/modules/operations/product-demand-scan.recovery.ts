import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import type { JobRunRow } from "@/server/db/database.helpers";
import { inspectTriggerRun, type TriggerRunInspection } from "../../providers/trigger/client";
import { isActiveProductDemandScanJob } from "./product-demand-scan.identity";

type Client = SupabaseClient<Database>;

export const DISPATCH_GRACE_MS = 60_000;
export const TRIGGER_STATUS_CHECK_INTERVAL_MS = 30_000;
export const EXECUTION_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export type ProductDemandScanRecoveryAction = "active" | "waiting" | "recovered" | "unknown";

export type ProductDemandScanRecoveryResult = {
  action: ProductDemandScanRecoveryAction;
  job: JobRunRow;
  reason?: string;
};

type RecoveryOptions = {
  now?: number;
  inspect?: (triggerRunId: string) => Promise<TriggerRunInspection>;
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageFrom(job: JobRunRow, now: number): number {
  const started = timestamp(job.dispatch_claimed_at) ?? timestamp(job.started_at) ?? timestamp(job.updated_at) ?? timestamp(job.created_at);
  return started === null ? Number.POSITIVE_INFINITY : Math.max(0, now - started);
}

function lastDispatchCheck(job: JobRunRow): number | null {
  return timestamp(job.dispatch_checked_at);
}

function terminalErrorCode(status: string): string {
  const normalized = status.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase().slice(0, 60);
  return `TRIGGER_RUN_${normalized || "TERMINAL"}`;
}

async function markOrphaned(client: Client, job: JobRunRow, now: number, errorCode: string, message: string): Promise<JobRunRow> {
  const iso = new Date(now).toISOString();
  const result = await client
    .from("job_runs")
    .update({
      status: "failed_terminal",
      dispatch_status: "orphaned",
      dispatch_checked_at: iso,
      error_code: errorCode,
      error_details: { message },
      completed_at: iso,
      terminal_at: iso,
      retry_after_at: null,
    })
    .eq("id", job.id)
    .in("status", ["pending", "running"])
    .select("*")
    .maybeSingle();
  if (result.error) throw new Error("The scan orphan state could not be persisted.");
  if (!result.data) {
    const latest = await client.from("job_runs").select("*").eq("id", job.id).maybeSingle();
    if (latest.error || !latest.data) throw new Error("The scan orphan state could not be confirmed.");
    return latest.data;
  }
  return result.data;
}

/**
 * Reconciles one active durable scan with its dispatch claim and Trigger run.
 * Unknown provider/API errors are deliberately non-destructive: an active job
 * is only orphaned when the durable evidence proves its run is terminal,
 * missing past the grace window, or never obtained a dispatch claim.
 */
export async function reconcileProductDemandScanJob(client: Client, job: JobRunRow, options: RecoveryOptions = {}): Promise<ProductDemandScanRecoveryResult> {
  const now = options.now ?? Date.now();
  if (!isActiveProductDemandScanJob(job)) return { action: "active", job };

  const age = ageFrom(job, now);
  const dispatchStatus = job.dispatch_status;
  const inspect = options.inspect ?? inspectTriggerRun;

  if (!job.trigger_run_id) {
    if (dispatchStatus === "not_applicable") return { action: "active", job };
    // A claimed row without a linked run is ambiguous: the process may have
    // crashed after Trigger accepted the idempotent request but before the
    // link write. Reuse the same key rather than creating a second provider
    // execution. The command will re-dispatch/retrieve it safely.
    if (dispatchStatus === "claimed") return { action: "waiting", job, reason: age <= DISPATCH_GRACE_MS ? "dispatch-grace" : "dispatch-link-uncertain" };
    if (age <= DISPATCH_GRACE_MS) return { action: "waiting", job, reason: "dispatch-grace" };
    const recovered = await markOrphaned(client, job, now, "TRIGGER_DISPATCH_ORPHANED", "The scan dispatch claim expired before a Trigger.dev run was linked.");
    return { action: "recovered", job: recovered, reason: "dispatch-claim-expired" };
  }

  const checkedAt = lastDispatchCheck(job);
  if (checkedAt !== null && now - checkedAt < TRIGGER_STATUS_CHECK_INTERVAL_MS && age < EXECUTION_TIMEOUT_MS) {
    return { action: "active", job, reason: "recently-checked" };
  }

  let inspection: TriggerRunInspection;
  try {
    inspection = await inspect(job.trigger_run_id);
  } catch {
    if (age >= EXECUTION_TIMEOUT_MS) {
      const recovered = await markOrphaned(client, job, now, "TRIGGER_RUN_UNVERIFIABLE", "The Trigger.dev run could not be verified before the execution timeout.");
      return { action: "recovered", job: recovered, reason: "execution-timeout" };
    }
    return { action: "unknown", job, reason: "provider-status-unavailable" };
  }

  if (inspection.state === "active") {
    const checked = await client
      .from("job_runs")
      .update({ dispatch_status: "linked", dispatch_checked_at: new Date(now).toISOString() })
      .eq("id", job.id)
      .in("status", ["pending", "running"])
      .select("*")
      .maybeSingle();
    return { action: "active", job: checked.data ?? job, reason: inspection.status };
  }

  const code = inspection.state === "missing" ? "TRIGGER_RUN_MISSING" : terminalErrorCode(inspection.status);
  const message = inspection.state === "missing"
    ? "The Trigger.dev run could not be found, so this scan can be safely retried."
    : "The Trigger.dev run ended before the durable scan completed, so this scan can be safely retried.";
  const recovered = await markOrphaned(client, job, now, code, message);
  return { action: "recovered", job: recovered, reason: inspection.status };
}

export async function reconcileActiveProductDemandScanJobs(client: Client, jobs: JobRunRow[], options: RecoveryOptions = {}): Promise<ProductDemandScanRecoveryResult[]> {
  const results: ProductDemandScanRecoveryResult[] = [];
  for (const job of jobs) results.push(await reconcileProductDemandScanJob(client, job, options));
  return results;
}
