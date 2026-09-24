import "server-only";

import { getServerEnv } from "../../lib/env";

function positive(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? Math.min(value!, maximum) : fallback;
}

function allowlisted(workspaceId: string, value: string | undefined): boolean {
  return value?.split(",").map((item) => item.trim()).filter(Boolean).includes(workspaceId) ?? false;
}

/**
 * Internal-only discovery expansion. It cannot enable a provider, exceed that
 * provider's existing request/page/read limits, or alter evaluation budgets.
 */
export function getDiscoveryCoverageConfig(workspaceId: string) {
  const env = getServerEnv();
  const enabled = env.DISCOVERY_COVERAGE_V1_ENABLED === "true"
    && allowlisted(workspaceId, env.DISCOVERY_COVERAGE_V1_WORKSPACE_IDS);
  return {
    enabled,
    maxSources: enabled ? positive(env.DISCOVERY_COVERAGE_V1_MAX_SOURCES, 6, 8) : null,
    maxQueries: enabled ? positive(env.DISCOVERY_COVERAGE_V1_MAX_QUERIES, 16, 24) : null,
    maxCandidates: enabled ? positive(env.DISCOVERY_COVERAGE_V1_MAX_CANDIDATES, 60, 100) : null,
  };
}
