/** Server-side kill switch. An unset or malformed value always preserves the legacy plan. */
export function signalQueryDiversificationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED === "true";
}
