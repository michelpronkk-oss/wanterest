export const READ_FIRST_INTELLIGENCE_VERSION = "read_first_intelligence_v1" as const;

export type ReadFirstFreshnessConfig = {
  freshMs: number;
  recentMs: number;
};

export const DEFAULT_READ_FIRST_FRESHNESS_CONFIG: ReadFirstFreshnessConfig = {
  // A daily window keeps the dashboard useful for the normal product view while
  // still allowing a later scheduler to choose shorter windows per source/type.
  freshMs: 24 * 60 * 60 * 1_000,
  // Three days is long enough to label persisted intelligence as useful without
  // treating it as current. Recent and stale data both request background work.
  recentMs: 72 * 60 * 60 * 1_000,
};

function positiveHours(value: string | undefined, fallbackMs: number): number {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1_000 : fallbackMs;
}

/**
 * Central Stage 1 defaults. The optional environment overrides are intentionally
 * generic; future source/demand-type policies can replace this resolver without
 * changing the read-first response contract.
 */
export function getReadFirstFreshnessConfig(env: Record<string, string | undefined> = process.env): ReadFirstFreshnessConfig {
  const freshMs = positiveHours(env.READ_FIRST_FRESH_HOURS, DEFAULT_READ_FIRST_FRESHNESS_CONFIG.freshMs);
  const recentMs = positiveHours(env.READ_FIRST_RECENT_HOURS, DEFAULT_READ_FIRST_FRESHNESS_CONFIG.recentMs);
  return { freshMs, recentMs: recentMs > freshMs ? recentMs : DEFAULT_READ_FIRST_FRESHNESS_CONFIG.recentMs };
}
