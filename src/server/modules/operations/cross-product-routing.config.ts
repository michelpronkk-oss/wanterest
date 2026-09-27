export type CrossProductRoutingMode = "off" | "shadow";

function workspaceAllowed(value: string | undefined, workspaceId: string | undefined): boolean {
  if (!workspaceId) return false;
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean)).has(workspaceId);
}

/** Explicit, fail-closed gate. Shadow mode is never global by accident. */
export function crossProductRoutingMode(env: Record<string, string | undefined> = process.env, workspaceId?: string): CrossProductRoutingMode {
  if (env.CROSS_PRODUCT_ROUTING_MODE !== "shadow") return "off";
  return workspaceAllowed(env.CROSS_PRODUCT_ROUTING_WORKSPACE_IDS, workspaceId) ? "shadow" : "off";
}

export function crossProductRoutingShadowEnabled(env: Record<string, string | undefined> = process.env, workspaceId?: string): boolean {
  return crossProductRoutingMode(env, workspaceId) === "shadow";
}
