export const ADAPTIVE_ALLOCATOR_VERSION = "adaptive_allocator_v1" as const;

export type AdaptiveAllocatorMode = "off" | "shadow" | "active";

function workspaceAllowed(value: string | undefined, workspaceId: string | undefined): boolean {
  if (!workspaceId) return false;
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean)).has(workspaceId);
}

/** Fail-closed mode gate. Missing or invalid configuration is always OFF. */
export function adaptiveAllocatorMode(env: Record<string, string | undefined> = process.env, workspaceId?: string): AdaptiveAllocatorMode {
  const requested = env.ADAPTIVE_ALLOCATOR_MODE;
  if (requested !== "shadow" && requested !== "active") return "off";
  return workspaceAllowed(env.ADAPTIVE_ALLOCATOR_WORKSPACE_IDS, workspaceId) ? requested : "off";
}

export function adaptiveAllocatorEnabled(env: Record<string, string | undefined> = process.env, workspaceId?: string): boolean {
  return adaptiveAllocatorMode(env, workspaceId) !== "off";
}
