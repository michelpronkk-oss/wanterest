export type SemanticReasoningShadowConfig = {
  enabled: boolean;
  maxNewProviderCallsPerScan: number;
};

const DEFAULT_MAX_NEW_PROVIDER_CALLS_PER_SCAN = 0;

function nonnegativeInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function workspaceAllowed(value: string | undefined, workspaceId: string | undefined): boolean {
  if (!workspaceId) return false;
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean)).has(workspaceId);
}

/**
 * Shadow reasoning is opt-in and has a zero-call default. Stage 2 only plans
 * calls; the cap is already applied here so later execution cannot exceed it.
 */
export function getSemanticReasoningShadowConfig(env: Record<string, string | undefined> = process.env, workspaceId?: string): SemanticReasoningShadowConfig {
  return {
    enabled: env.SEMANTIC_REASONING_SHADOW_ENABLED === "true" && workspaceAllowed(env.SEMANTIC_REASONING_SHADOW_WORKSPACE_IDS, workspaceId),
    maxNewProviderCallsPerScan: nonnegativeInteger(env.SEMANTIC_REASONING_SHADOW_MAX_NEW_CALLS_PER_SCAN, DEFAULT_MAX_NEW_PROVIDER_CALLS_PER_SCAN),
  };
}
