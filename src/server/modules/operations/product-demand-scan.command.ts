import "server-only";

import { requireUser } from "@/server/modules/auth";
import { getProductQuery } from "@/server/modules/products";
import { AppError } from "@/server/lib/errors";
import { redactMessage } from "@/server/lib/http";
import { getTraceId } from "@/server/lib/request-context";
import { attachTriggerRun, claimProductDemandScanDispatch, executeProductDemandScan, markProductDemandScanDispatchNotApplicable, markProductDemandScanDispatchPersistenceFailure, markProductDemandScanTriggerFailure, prepareProductDemandScan, productDemandScanHandle } from "./product-demand-scan.service";
import { productDemandScanRequestSchema, type ProductDemandScanHandle } from "./product-demand-scan.schemas";
import { buildProductDemandScanInput, initialScanIdempotencyKey, manualScanIdempotencyKey } from "./product-demand-scan.identity";
import { describeTriggerDispatchError, getTriggerDispatchDiagnostics, getTriggerRuntimeConfig, triggerProductDemandScan } from "@/server/providers/trigger/client";

export async function requestProductDemandScanCommand(rawInput: unknown, _request?: Request): Promise<ProductDemandScanHandle> {
  void _request;
  const parsed = productDemandScanRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid product scan input.", 422, { issues: parsed.error.issues });
  const idempotencyKey = parsed.data.idempotencyKey
    ?? (parsed.data.scanMode === "manual"
      ? manualScanIdempotencyKey(parsed.data.workspaceId, parsed.data.productId)
      : parsed.data.scanMode === "onboarding"
        ? initialScanIdempotencyKey(parsed.data.workspaceId, parsed.data.productId)
        : null);
  if (!idempotencyKey) throw new AppError("VALIDATION_ERROR", "A scan idempotency key is required for this scan mode.", 422);
  const user = await requireUser();
  const input = buildProductDemandScanInput(parsed.data, idempotencyKey, user.id);
  await getProductQuery(input.workspaceId, input.productId);
  const prepared = await prepareProductDemandScan({ ...input, requestedByUserId: user.id }, undefined);
  if (!prepared.shouldTrigger) {
    return productDemandScanHandle(prepared.job, prepared.job.trigger_run_id, "resumed", input.scanMode);
  }

  if (prepared.job.status === "pending" || prepared.job.status === "failed" || prepared.job.status === "failed_terminal") {
    // prepared.shouldTrigger already guarantees a "failed"/"failed_terminal" job only
    // reaches here when the caller explicitly requested forceRebuild. The claim atomically
    // resets the terminal state to "running" so the dispatch below can be linked; without
    // this, a retried job stays stuck outside "running" and attachTriggerRun can never
    // record the new run, permanently failing every retry.
    const claimed = await claimProductDemandScanDispatch(prepared.job.id, prepared.job.status);
    if (!claimed) {
      return productDemandScanHandle(prepared.job, prepared.job.trigger_run_id, "resumed", input.scanMode);
    }
  }

  const triggerConfig = getTriggerRuntimeConfig();
  if (triggerConfig.executionMode === "direct") {
    await markProductDemandScanDispatchNotApplicable(prepared.job.id);
    await executeProductDemandScan(prepared.input);
    const completed = { ...prepared.job, status: "succeeded" };
    return productDemandScanHandle(completed, null, prepared.recoveredOrphan ? "recovered" : prepared.resumedExistingJob ? "resumed" : "started", input.scanMode);
  }
  if (!triggerConfig.triggerSecretPresent) {
    await markProductDemandScanTriggerFailure(prepared.job.id, new Error("TRIGGER_SECRET_KEY is not configured."));
    throw new AppError("INTERNAL_ERROR", "Background scan processing is not configured.");
  }

  let handle: Awaited<ReturnType<typeof triggerProductDemandScan>>;
  try {
    handle = await triggerProductDemandScan(prepared.input, {
      idempotencyKey: prepared.input.idempotencyKey,
      concurrencyKey: `product:${prepared.input.workspaceId}:${prepared.input.productId}`,
    });
  } catch (error) {
    await markProductDemandScanTriggerFailure(prepared.job.id, error);
    // Log the full, structured diagnosis BEFORE wrapping: the wrapped AppError only ever
    // carries a truncated, already-safe message to the client. Everything logged here is
    // safe by construction — booleans, a key-format prefix (never the token), the public
    // task/project identifiers, and the SDK error's own name/status/code/message (redacted
    // as a last defense in case a provider error ever echoed a header value back).
    const details = describeTriggerDispatchError(error);
    const diagnostics = getTriggerDispatchDiagnostics();
    console.error("[trigger] product-demand-scan dispatch failed", {
      traceId: getTraceId(),
      taskId: diagnostics.taskId,
      projectRef: diagnostics.projectRef,
      apiKeyConfigured: diagnostics.apiKeyConfigured,
      apiKeyPrefix: diagnostics.apiKeyPrefix,
      vercelEnv: diagnostics.vercelEnv,
      errorName: details.errorName,
      errorMessage: redactMessage(details.errorMessage),
      errorCode: details.errorCode,
      status: details.status,
    });
    // The Trigger.dev SDK throws its own (non-AppError) error shapes. Wrap it so
    // the client gets a safe, typed message instead of toPublicError's generic
    // "An unexpected error occurred." fallback, while the redacted provider
    // message above is already persisted on the job row for diagnosis.
    throw new AppError("SCAN_DISPATCH_FAILED", "The scan could not be started. Please try again.", 502, { providerMessage: details.errorMessage.slice(0, 500) });
  }
  try {
    await attachTriggerRun(prepared.job.id, handle.id);
  } catch (error) {
    // The provider request may already have succeeded. Keep the claim alive so
    // the same idempotency key can safely retrieve/link that run on retry.
    await markProductDemandScanDispatchPersistenceFailure(prepared.job.id, error);
    throw error;
  }
  return productDemandScanHandle(prepared.job, handle.id, prepared.recoveredOrphan ? "recovered" : prepared.resumedExistingJob ? "resumed" : "started", input.scanMode);
}

export async function runProductDemandScanDirectCommand(rawInput: unknown): Promise<Awaited<ReturnType<typeof executeProductDemandScan>>> {
  const requestInput = productDemandScanRequestSchema.parse(rawInput);
  const idempotencyKey = requestInput.idempotencyKey
    ?? (requestInput.scanMode === "manual"
      ? manualScanIdempotencyKey(requestInput.workspaceId, requestInput.productId)
      : requestInput.scanMode === "onboarding"
        ? initialScanIdempotencyKey(requestInput.workspaceId, requestInput.productId)
        : null);
  if (!idempotencyKey) throw new AppError("VALIDATION_ERROR", "A scan idempotency key is required for this scan mode.", 422);
  const user = await requireUser();
  const parsed = buildProductDemandScanInput(requestInput, idempotencyKey, user.id);
  const prepared = await prepareProductDemandScan({ ...parsed, requestedByUserId: user.id });
  return executeProductDemandScan(prepared.input);
}
