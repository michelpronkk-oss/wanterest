import "server-only";

import { configure, runs, tasks } from "@trigger.dev/sdk";
import type { productDemandScanTask } from "@/trigger/product-demand-scan";

import { getServerEnv } from "@/server/lib/env";
import type { ProductDemandScanInput } from "@/server/modules/operations/product-demand-scan.schemas";
import { PRODUCT_DEMAND_SCAN_TASK_ID, TRIGGER_PROJECT_REF, resolveTriggerRuntimeConfig, triggerKeyPrefix } from "./config";

export { PRODUCT_DEMAND_SCAN_TASK_ID, TRIGGER_PROJECT_REF } from "./config";
export type { TriggerExecutionMode, TriggerRuntimeConfig } from "./config";

// Root cause of the live "No matching branch env" dispatch failures: the Trigger.dev SDK
// opportunistically attaches an x-trigger-branch header derived from VERCEL_GIT_COMMIT_REF
// (Vercel sets this on every deployment, production included) whenever no explicit
// previewBranch is configured. Wanterest does not use Trigger.dev's Git-branch preview-
// environments feature (no TRIGGER_PREVIEW_BRANCH is configured anywhere), so that branch
// name never corresponds to a real branch environment and the server rejects the request
// before it reaches the task — for every SDK call in this process, not just dispatch
// (runs.retrieve() reconciliation below is equally exposed). An explicit empty string (not
// undefined — the SDK's own `??` fallback chain only treats null/undefined as "unset")
// pins every call made through this client to the deployment's default (non-branched)
// environment, matching how this app is actually deployed. This only sets `previewBranch`;
// TRIGGER_SECRET_KEY/TRIGGER_API_URL resolution from env is untouched.
configure({ previewBranch: "" });

export function getTriggerRuntimeConfig() {
  const env = getServerEnv();
  return resolveTriggerRuntimeConfig({ secretKey: env.TRIGGER_SECRET_KEY, localExecution: env.TRIGGER_LOCAL_EXECUTION });
}

export function triggerProductDemandScan(input: ProductDemandScanInput, options: { idempotencyKey: string; concurrencyKey: string }) {
  return tasks.trigger<typeof productDemandScanTask>(PRODUCT_DEMAND_SCAN_TASK_ID, input, options);
}

export type TriggerDispatchDiagnostics = {
  taskId: typeof PRODUCT_DEMAND_SCAN_TASK_ID;
  projectRef: typeof TRIGGER_PROJECT_REF;
  apiKeyConfigured: boolean;
  /** "tr_dev_" / "tr_prod_" / null — never the token itself. */
  apiKeyPrefix: string | null;
  /** Vercel's own deployment target ("production" | "preview" | "development"), when running on Vercel. */
  vercelEnv: string | null;
};

/** Safe to log unconditionally: booleans, a key-format prefix, and known-public identifiers, never the key itself. */
export function getTriggerDispatchDiagnostics(): TriggerDispatchDiagnostics {
  const env = getServerEnv();
  return {
    taskId: PRODUCT_DEMAND_SCAN_TASK_ID,
    projectRef: TRIGGER_PROJECT_REF,
    apiKeyConfigured: Boolean(env.TRIGGER_SECRET_KEY?.trim()),
    apiKeyPrefix: triggerKeyPrefix(env.TRIGGER_SECRET_KEY),
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };
}

export type TriggerDispatchErrorDetails = {
  errorName: string;
  errorMessage: string;
  errorCode: string | null;
  status: number | null;
};

/**
 * Extracts safe, loggable fields from whatever the Trigger.dev SDK throws. The SDK's own
 * ApiError subclasses (TriggerApiError, AuthenticationError, PermissionDeniedError, ...)
 * all carry `status`/`code`/`name`/`message`, but are read structurally here rather than
 * via `instanceof` so this keeps working even if a different copy of the SDK's error
 * classes ends up bundled (a known cross-package `instanceof` pitfall).
 */
export function describeTriggerDispatchError(error: unknown): TriggerDispatchErrorDetails {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const status = typeof record.status === "number" ? record.status : typeof record.statusCode === "number" ? record.statusCode : null;
    const code = typeof record.code === "string" ? record.code : null;
    const name = typeof record.name === "string" ? record.name : error instanceof Error ? error.constructor.name : "UnknownError";
    const message = error instanceof Error ? error.message : typeof record.message === "string" ? record.message : JSON.stringify(error);
    return { errorName: name, errorMessage: message, errorCode: code, status };
  }
  return { errorName: "UnknownError", errorMessage: String(error), errorCode: null, status: null };
}

export type TriggerRunInspection = {
  state: "active" | "terminal" | "missing";
  status: string;
};

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  const status = value.status ?? value.statusCode;
  if (status === 404 || status === "404") return true;
  const message = typeof value.message === "string" ? value.message : error instanceof Error ? error.message : "";
  return /\bnot found\b|\b404\b/i.test(message);
}

/** Reads provider state for durable recovery; it never exposes run payloads or errors. */
export async function inspectTriggerRun(triggerRunId: string): Promise<TriggerRunInspection> {
  try {
    const run = await runs.retrieve(triggerRunId);
    const status = String(run.status);
    const terminal = run.isCompleted || run.isFailed || run.isCancelled || ["CANCELED", "COMPLETED", "CRASHED", "EXPIRED", "FAILED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(status);
    return { state: terminal ? "terminal" : "active", status };
  } catch (error) {
    if (isNotFoundError(error)) return { state: "missing", status: "NOT_FOUND" };
    throw error;
  }
}
