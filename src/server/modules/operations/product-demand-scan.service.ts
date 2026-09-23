import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { jsonObjectSchema, type JobRunRow, type ProductRow } from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";
import { getTraceId } from "@/server/lib/request-context";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { consumeUsage, getUsageTotals, getWorkspaceEntitlement } from "@/server/modules/entitlements/entitlement.repository";
import { resolveMonitoringPolicy } from "@/server/modules/entitlements/monitoring-policy";
import { scanProfileForMode } from "@/server/modules/entitlements/plan-capabilities";
import { recordMonitoringScanOutcome } from "@/server/modules/monitoring/monitoring.repository";
import { materializeMonitoringNotifications } from "@/server/modules/monitoring/monitoring.notifications";
import { isActiveProduct } from "@/server/modules/products/product-lifecycle";
import { runInitialScan, scanJobKey, type InitialScanExecutionOptions, type InitialScanResult } from "../onboarding/initial-scan.service";
import { isTrustedProductDemandScanJob } from "./product-demand-scan.authorization";
import { PRODUCT_DEMAND_SCAN_JOB_TYPE, scanModeFromJob, selectActiveProductDemandScanJob } from "./product-demand-scan.identity";
import { reconcileActiveProductDemandScanJobs, reconcileProductDemandScanJob } from "./product-demand-scan.recovery";
import { frontendScanStatus, productDemandScanInputSchema, productDemandScanSummarySchema, scanProgressSchema, sourceScanResultSchema, type ProductDemandScanHandle, type ProductDemandScanInput, type ProductDemandScanSummary } from "./product-demand-scan.schemas";

type Client = SupabaseClient<Database>;

function providerError(message: string, providerMessage?: string): AppError {
  return new AppError("INTERNAL_ERROR", message, 500, providerMessage ? { providerMessage } : undefined);
}

async function loadProductForTask(client: Client, input: ProductDemandScanInput): Promise<ProductRow> {
  const membership = await client
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.requestedByUserId)
    .eq("status", "active")
    .maybeSingle();
  if (membership.error) throw providerError("Scan authorization could not be verified.", membership.error.message);
  if (!membership.data) throw new AppError("FORBIDDEN", "You are not authorized to scan this workspace.");
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.productId)
    .maybeSingle();
  if (error) throw providerError("The scan product could not be loaded.", error.message);
  if (!data) throw new AppError("NOT_FOUND", "The scan product was not found.");
  if (!isActiveProduct(data)) throw new AppError("CONFLICT", "Archived products cannot be scanned.");
  return data;
}

async function loadTrustedProductDemandScanJob(client: Client, input: ProductDemandScanInput): Promise<JobRunRow | null> {
  if (!input.jobRunId) return null;
  const { data, error } = await client.from("job_runs").select("*").eq("id", input.jobRunId).maybeSingle();
  if (error) throw providerError("The scan job could not be verified.", error.message);
  if (!data || !isTrustedProductDemandScanJob(input, data)) {
    throw new AppError("FORBIDDEN", "The scan job is not authorized for this workspace.");
  }
  return data;
}

export type PreparedProductDemandScan = {
  input: ProductDemandScanInput;
  job: JobRunRow;
  shouldTrigger: boolean;
  resumedExistingJob: boolean;
  recoveredOrphan: boolean;
};

export async function prepareProductDemandScan(input: ProductDemandScanInput, traceId = getTraceId()): Promise<PreparedProductDemandScan> {
  const parsed = productDemandScanInputSchema.parse(input);
  const client = createSupabaseServiceClient();
  await loadProductForTask(client, parsed);
  const scanEntitlement = await getWorkspaceEntitlement(client, parsed.workspaceId, "scan_frequency");
  if (scanEntitlement.value === null) throw new AppError("CAPABILITY_DISABLED", "Scanning is not enabled for this workspace.", 403, {
    entitlementCode: "SCAN_FREQUENCY_DISABLED",
    capability: "scan_frequency",
    upgradeTarget: "pro",
  });
  const existingResult = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE)
    .eq("workspace_id", parsed.workspaceId)
    .eq("product_id", parsed.productId)
    .eq("idempotency_key", parsed.idempotencyKey)
    .maybeSingle();
  if (existingResult.error) throw providerError("The scan job could not be loaded.", existingResult.error.message);
  if (existingResult.data) {
    const reconciled = await reconcileProductDemandScanJob(client, existingResult.data);
    if (reconciled.action === "recovered") {
      return prepareProductDemandScan(parsed, traceId);
    }
    return {
      input: { ...parsed, jobRunId: reconciled.job.id, idempotencyKey: reconciled.job.idempotency_key },
      job: reconciled.job,
      shouldTrigger: (!reconciled.job.trigger_run_id && (reconciled.job.status === "pending" || (reconciled.job.status === "running" && reconciled.job.dispatch_status === "claimed"))) || ((reconciled.job.status === "failed" || reconciled.job.status === "failed_terminal") && parsed.forceRebuild),
      resumedExistingJob: true,
      recoveredOrphan: false,
    };
  }

  const active = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE)
    .eq("workspace_id", parsed.workspaceId)
    .eq("product_id", parsed.productId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (active.error) throw providerError("Active scan state could not be loaded.", active.error.message);
  const reconciled = await reconcileActiveProductDemandScanJobs(client, active.data ?? []);
  const activeJob = selectActiveProductDemandScanJob(reconciled.filter((result) => result.action !== "recovered").map((result) => result.job), parsed.scanMode);
  if (activeJob) {
    return {
      input: { ...parsed, jobRunId: activeJob.id, idempotencyKey: activeJob.idempotency_key },
      job: activeJob,
      shouldTrigger: !activeJob.trigger_run_id && (activeJob.status === "pending" || (activeJob.status === "running" && activeJob.dispatch_status === "claimed")),
      resumedExistingJob: true,
      recoveredOrphan: reconciled.some((result) => result.action === "recovered"),
    };
  }

  if ((parsed.scanMode === "manual" || parsed.scanMode === "manual_refresh" || parsed.scanMode === "manual_deep") && !parsed.forceRebuild) {
    const policy = await resolveMonitoringPolicy(client, parsed.workspaceId);
    if (policy.manualRefreshCooldownMinutes > 0) {
      const recent = await client.from("job_runs").select("*").eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE).eq("workspace_id", parsed.workspaceId).eq("product_id", parsed.productId).order("created_at", { ascending: false }).limit(20);
      if (recent.error) throw providerError("Recent scan history could not be loaded.", recent.error.message);
      const now = Date.now();
      const recentManual = (recent.data ?? []).find((candidate) => {
        const mode = scanModeFromJob(candidate);
        return (mode === "manual" || mode === "manual_refresh" || mode === "manual_deep") && now - Date.parse(candidate.created_at) < policy.manualRefreshCooldownMinutes * 60_000;
      });
      if (recentManual) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(recentManual.created_at) + policy.manualRefreshCooldownMinutes * 60_000 - now) / 1_000));
        throw new AppError("RATE_LIMITED", "Refresh intelligence is available again soon.", 429, { retryAfterSeconds });
      }
    }
  }

  if (parsed.scanMode === "manual" || parsed.scanMode === "manual_refresh" || parsed.scanMode === "manual_deep") {
    const manualEntitlement = await getWorkspaceEntitlement(client, parsed.workspaceId, "manual_scans_monthly");
    if (typeof manualEntitlement.value === "number") {
      const totals = await getUsageTotals(client, parsed.workspaceId);
      const used = totals.find((entry) => entry.usage_type === "manual_scan")?.amount ?? 0;
      const limit = manualEntitlement.value;
      if (used >= limit) {
        throw new AppError("USAGE_LIMIT_EXCEEDED", "The monthly manual scan limit was reached.", 429, {
          entitlementCode: "MANUAL_SCAN_LIMIT_REACHED",
          capability: "manual_scans_monthly",
          current: used,
          limit,
          upgradeTarget: limit <= 3 ? "pro" : "growth",
        });
      }
    }
  }

  const reference = jsonObjectSchema.parse({
    workflow: "product-demand-scan",
    scanMode: parsed.scanMode,
    requestedByUserId: parsed.requestedByUserId,
    forceRebuild: parsed.forceRebuild,
    phase: "queued",
    progress: { stage: "queued", percent: 0, completedSources: 0, totalSources: 0, currentLabel: "Queued", warnings: [] },
  });
  const created = await client.from("job_runs").insert({
    job_type: PRODUCT_DEMAND_SCAN_JOB_TYPE,
    workspace_id: parsed.workspaceId,
    product_id: parsed.productId,
    idempotency_key: parsed.idempotencyKey,
    input_reference: reference,
    status: "pending",
    attempt_count: 0,
    trace_id: traceId,
  }).select("*").single();
  if (created.error || !created.data) {
    if (created.error?.code === "23505") return prepareProductDemandScan(parsed, traceId);
    throw providerError("The scan job could not be created.", created.error?.message);
  }
  return { input: { ...parsed, jobRunId: created.data.id }, job: created.data, shouldTrigger: true, resumedExistingJob: false, recoveredOrphan: reconciled.some((result) => result.action === "recovered") };
}

export async function executeProductDemandScan(input: ProductDemandScanInput, triggerRunId?: string, executionOptions: Pick<InitialScanExecutionOptions, "sourceExecutor" | "sourceBatchExecutor" | "candidateExecutor" | "demandExecutor" | "actionsExecutor"> = {}): Promise<InitialScanResult> {
  const parsed = productDemandScanInputSchema.parse(input);
  const client = createSupabaseServiceClient();
  const job = await loadTrustedProductDemandScanJob(client, parsed);
  const product = await loadProductForTask(client, parsed);
  const scanEntitlement = await getWorkspaceEntitlement(client, parsed.workspaceId, "scan_frequency");
  if (scanEntitlement.value === null) throw new AppError("CAPABILITY_DISABLED", "Scanning is not enabled for this workspace.");
  try {
    const result = await runInitialScan(product, getTraceId(), {
      scanMode: parsed.scanMode,
      idempotencyKey: parsed.idempotencyKey,
      jobRunId: parsed.jobRunId,
      triggerRunId,
      ...executionOptions,
    });
    // Usage is charged only once the scan has actually produced a terminal
    // outcome. A scan that throws before this point (source/provider/dispatch
    // failure) must not permanently consume the workspace's scan allowance;
    // zero qualified signals is still a successful, chargeable outcome.
    await consumeUsage(client, {
      workspaceId: parsed.workspaceId,
      usageType: ["manual", "manual_refresh", "manual_deep"].includes(parsed.scanMode) ? "manual_scan" : "source_scan",
      amount: 1,
      idempotencyKey: `source_scan:${job?.idempotency_key ?? parsed.idempotencyKey}`,
      actorUserId: parsed.requestedByUserId,
      sourceMetadata: { workflow: "product-demand-scan", scanMode: parsed.scanMode, scanProfile: scanProfileForMode(parsed.scanMode), productId: parsed.productId, jobRunId: parsed.jobRunId ?? null, triggerRunId: triggerRunId ?? null },
      traceId: getTraceId(),
    });
    if (parsed.monitoringScheduleId && parsed.jobRunId) {
      await recordMonitoringScanOutcome(client, {
        scheduleId: parsed.monitoringScheduleId,
        jobRunId: parsed.jobRunId,
        succeeded: true,
        scanMode: parsed.scanMode,
        newCandidateCount: result.evaluations,
        newSignalCount: result.newSignals ?? result.signals,
        intelligenceUpdated: (result.newSignals ?? result.signals) > 0,
        xCostUsd: result.sourceResults?.filter((source) => source.sourceKey === "x").reduce((sum, source) => sum + (source.estimatedCost ?? 0), 0),
      });
      await materializeMonitoringNotifications({ workspaceId: parsed.workspaceId, productId: parsed.productId, completedAt: new Date().toISOString() }).catch((notificationError) => {
        if (process.env.NODE_ENV !== "production") console.warn("[monitoring] notification materialization failed", notificationError instanceof Error ? notificationError.message : "unknown error");
      });
    }
    return result;
  } catch (error) {
    if (parsed.monitoringScheduleId && parsed.jobRunId) {
      await recordMonitoringScanOutcome(client, {
        scheduleId: parsed.monitoringScheduleId,
        jobRunId: parsed.jobRunId,
        succeeded: false,
        scanMode: parsed.scanMode,
        errorCode: error instanceof AppError ? error.code : "MONITORING_SCAN_FAILED",
        message: error instanceof Error ? error.message : "Scheduled scan failed.",
      }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Claims a job for dispatch so concurrent requests cannot create two Trigger runs.
 * A "pending" claim is the normal first dispatch. A "failed"/"failed_terminal" claim
 * is a forced retry of a terminal job: it resets the prior terminal state (including
 * any stale trigger_run_id) so the retry starts a fresh, trackable dispatch instead of
 * being unable to ever re-link because the row is stuck outside "running".
 */
export async function claimProductDemandScanDispatch(jobRunId: string, fromStatus: "pending" | "failed" | "failed_terminal" = "pending"): Promise<boolean> {
  const isRetry = fromStatus !== "pending";
  const update = {
    status: "running" as const,
    dispatch_status: "claimed" as const,
    dispatch_claimed_at: new Date().toISOString(),
    dispatch_checked_at: null,
    started_at: new Date().toISOString(),
    ...(isRetry ? { trigger_run_id: null, error_code: null, error_details: null, completed_at: null, terminal_at: null, retry_after_at: null } : {}),
  };
  let query = createSupabaseServiceClient().from("job_runs").update(update).eq("id", jobRunId).eq("status", fromStatus);
  if (!isRetry) query = query.is("trigger_run_id", null);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw providerError("The scan job could not be claimed for dispatch.", error.message);
  return Boolean(data);
}

export async function attachTriggerRun(jobRunId: string, triggerRunId: string): Promise<void> {
  const { data, error } = await createSupabaseServiceClient().from("job_runs").update({ trigger_run_id: triggerRunId, dispatch_status: "linked", dispatch_checked_at: new Date().toISOString() }).eq("id", jobRunId).eq("status", "running").is("trigger_run_id", null).select("id").maybeSingle();
  if (error) throw providerError("The Trigger.dev run could not be linked to the scan job.", error.message);
  if (!data) throw providerError("The Trigger.dev run could not be linked to the scan job.");
}

export async function markProductDemandScanDispatchNotApplicable(jobRunId: string): Promise<void> {
  const { error } = await createSupabaseServiceClient().from("job_runs").update({ dispatch_status: "not_applicable", dispatch_checked_at: new Date().toISOString() }).eq("id", jobRunId).eq("status", "running");
  if (error) throw providerError("The scan job could not be marked for direct execution.", error.message);
}

export async function markProductDemandScanDispatchPersistenceFailure(jobRunId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 500) : "The Trigger.dev run could not be linked to the scan job.";
  await createSupabaseServiceClient().from("job_runs").update({ dispatch_status: "claimed", error_code: "TRIGGER_RUN_LINK_FAILED", error_details: { message }, dispatch_checked_at: null }).eq("id", jobRunId).eq("status", "running").is("trigger_run_id", null);
}

export async function markProductDemandScanTriggerFailure(jobRunId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.replace(/(authorization|bearer|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 500) : "Trigger.dev could not start the scan.";
  const now = new Date().toISOString();
  await createSupabaseServiceClient().from("job_runs").update({ status: "failed", dispatch_status: "failed", error_code: "TRIGGER_START_FAILED", error_details: { message }, completed_at: now, terminal_at: now, dispatch_checked_at: now }).eq("id", jobRunId);
}

export function productDemandScanHandle(job: JobRunRow, triggerRunId: string | null, status: "started" | "resumed" | "recovered", scanMode: ProductDemandScanInput["scanMode"]): ProductDemandScanHandle {
  return { jobRunId: job.id, idempotencyKey: job.idempotency_key, status, scanMode, triggerRunId };
}

export async function getProductDemandScanSummary(workspaceId: string, productId: string, idempotencyKey = scanJobKey(workspaceId, productId)): Promise<ProductDemandScanSummary | null> {
  const client = createSupabaseServiceClient();
  const { data: job, error } = await client
    .from("job_runs")
    .select("*")
    .eq("job_type", PRODUCT_DEMAND_SCAN_JOB_TYPE)
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw providerError("The scan summary could not be loaded.", error.message);
  if (!job) return null;
  const reference = job.input_reference && typeof job.input_reference === "object" && !Array.isArray(job.input_reference) ? job.input_reference : {};
  const progressValue = "progress" in reference ? scanProgressSchema.safeParse(reference.progress) : null;
  const resultValue = "result" in reference && reference.result && typeof reference.result === "object" && !Array.isArray(reference.result) ? reference.result : null;
  const sourceResults = resultValue && "sourceResults" in resultValue && Array.isArray(resultValue.sourceResults)
    ? resultValue.sourceResults.map((value) => sourceScanResultSchema.safeParse(value)).filter((value): value is { success: true; data: ReturnType<typeof sourceScanResultSchema.parse> } => value.success).map((value) => value.data)
    : [];
  const diagnostics = resultValue && "diagnostics" in resultValue && Array.isArray(resultValue.diagnostics) ? resultValue.diagnostics : [];
  const numeric = (key: string): number => resultValue && key in resultValue && typeof resultValue[key] === "number" ? resultValue[key] : 0;
  const qualification = resultValue && "qualification" in resultValue && resultValue.qualification && typeof resultValue.qualification === "object" && !Array.isArray(resultValue.qualification) ? resultValue.qualification : null;
  const sourceCount = resultValue && "sources" in resultValue && Array.isArray(resultValue.sources) ? resultValue.sources.length : 0;
  const hasSourceResults = sourceResults.length > 0;
  const warnings = progressValue?.success
    ? progressValue.data.warnings
    : diagnostics.filter((value): value is { sourceKey: string; state: string; message: string } => typeof value === "object" && value !== null && "message" in value && typeof value.message === "string").map((value) => value.message).slice(0, 100);
  return productDemandScanSummarySchema.parse({
    jobRunId: job.id,
    status: frontendScanStatus(progressValue?.success ? progressValue.data : null, job.status),
    startedAt: job.started_at,
    completedAt: job.completed_at,
    sourcesPlanned: hasSourceResults ? sourceResults.length : sourceCount,
    sourcesCompleted: hasSourceResults ? sourceResults.filter((source) => source.status === "completed").length : sourceCount,
    sourcesFailed: sourceResults.filter((source) => source.status === "failed").length,
    rawItems: numeric("rawItems"),
    normalizedItems: numeric("normalizedItems") || sourceResults.reduce((sum, source) => sum + source.normalizedItems, 0),
    qualifiedSignals: numeric("signals"),
    highConfidenceSignals: qualification && "highConfidenceCount" in qualification && typeof qualification.highConfidenceCount === "number" ? qualification.highConfidenceCount : 0,
    mapUpdated: numeric("mapUpdated"),
    gapUpdated: numeric("gapUpdated"),
    driftUpdated: numeric("driftUpdated"),
    actionsUpdated: numeric("actionsUpdated"),
    warnings,
  });
}

export function defaultProductDemandScanKey(workspaceId: string, productId: string): string {
  return scanJobKey(workspaceId, productId);
}
