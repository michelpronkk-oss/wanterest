/** Server-side kill switch. An unset or malformed value always preserves the legacy plan. */
export function signalQueryDiversificationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED === "true";
}

/** V1.1 is an additional server-only gate; it is inert unless V1 is enabled too. */
export function signalQueryExplorationV11Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNAL_QUERY_EXPLORATION_V11_ENABLED === "true";
}
