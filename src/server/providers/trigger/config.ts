export const PRODUCT_DEMAND_SCAN_TASK_ID = "product-demand-scan" as const;

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
