import "server-only";

import { runs, tasks } from "@trigger.dev/sdk";
import type { productDemandScanTask } from "@/trigger/product-demand-scan";

import { getServerEnv } from "@/server/lib/env";
import type { ProductDemandScanInput } from "@/server/modules/operations/product-demand-scan.schemas";
import { PRODUCT_DEMAND_SCAN_TASK_ID, resolveTriggerRuntimeConfig } from "./config";

export { PRODUCT_DEMAND_SCAN_TASK_ID } from "./config";
export type { TriggerExecutionMode, TriggerRuntimeConfig } from "./config";

export function getTriggerRuntimeConfig() {
  const env = getServerEnv();
  return resolveTriggerRuntimeConfig({ secretKey: env.TRIGGER_SECRET_KEY, localExecution: env.TRIGGER_LOCAL_EXECUTION });
}

export function triggerProductDemandScan(input: ProductDemandScanInput, options: { idempotencyKey: string; concurrencyKey: string }) {
  return tasks.trigger<typeof productDemandScanTask>(PRODUCT_DEMAND_SCAN_TASK_ID, input, options);
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
