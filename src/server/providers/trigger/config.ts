export const PRODUCT_DEMAND_SCAN_TASK_ID = "product-demand-scan" as const;

/**
 * Must match trigger.config.ts's `project` field. trigger.config.ts is read only by the
 * Trigger CLI/build step (deploy, dev), never imported into the Next.js server runtime,
 * so this constant is kept here too — diagnostics/logging only, never used for auth or
 * dispatch, and there is nothing here that needs to stay secret.
 */
export const TRIGGER_PROJECT_REF = "proj_cxghokhenspxdbmgrczh" as const;

export type TriggerExecutionMode = "direct" | "remote";

export type TriggerRuntimeConfig = {
  executionMode: TriggerExecutionMode;
  triggerConfigured: boolean;
  triggerSecretPresent: boolean;
};

export function resolveTriggerRuntimeConfig(input: { secretKey?: string | null; localExecution?: string | null }): TriggerRuntimeConfig {
  const triggerSecretPresent = Boolean(input.secretKey?.trim());
  const executionMode: TriggerExecutionMode = input.localExecution === "direct" ? "direct" : "remote";
  return {
    executionMode,
    triggerSecretPresent,
    triggerConfigured: executionMode === "direct" || triggerSecretPresent,
  };
}

/**
 * First segment of a Trigger.dev secret key ("tr_dev_", "tr_prod_", ...), safe to log —
 * it never includes the random token material after the environment segment. A `tr_dev_`
 * key configured in a production deployment is one of the most common causes of a
 * dispatch that authenticates the *account* but can't reach a task only deployed to
 * `prod` (see TRIGGER_DEV_BRANCH/branch-preview routing in the Trigger.dev SDK).
 */
export function triggerKeyPrefix(secretKey?: string | null): string | null {
  const trimmed = secretKey?.trim();
  if (!trimmed) return null;
  const match = /^tr_[a-z]+_/.exec(trimmed);
  return match ? match[0] : "unrecognized_format";
}
