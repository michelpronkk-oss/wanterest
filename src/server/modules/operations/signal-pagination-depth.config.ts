import "server-only";

/** Unset or false is the exact released V1/V1.1 cursor path. */
export function signalPaginationDepthV1Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNAL_PAGINATION_DEPTH_V1_ENABLED === "true";
}
