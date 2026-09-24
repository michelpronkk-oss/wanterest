import { getServerEnv } from "@/server/lib/env";

import { estimateXReadCost, X_PROVIDER_MIN_RESULTS } from "./x.cost";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal validation may fund exactly one provider-minimum X page per query. */
export const INTERNAL_X_MAX_POSTS_HARD_CAP = X_PROVIDER_MIN_RESULTS;
/** Stage 1A measures the currently planned three X queries, and nothing beyond them. */
export const INTERNAL_X_MAX_QUERIES_HARD_CAP = 3;

export type InternalXDiscoveryOverride = {
  workspaceId: string;
  maxPostsPerScan: number;
};

function parseWorkspaceIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => UUID_PATTERN.test(value)),
  );
}

export function getInternalXDiscoveryOverride(workspaceId: string | undefined): InternalXDiscoveryOverride | null {
  if (!workspaceId) return null;
  const env = getServerEnv();
  const normalizedWorkspaceId = workspaceId.trim().toLowerCase();
  if (!parseWorkspaceIds(env.INTERNAL_X_DISCOVERY_WORKSPACE_IDS).has(normalizedWorkspaceId)) return null;
  if (!env.INTERNAL_X_MAX_POSTS_PER_SCAN) return null;
  return {
    workspaceId: normalizedWorkspaceId,
    maxPostsPerScan: Math.min(env.INTERNAL_X_MAX_POSTS_PER_SCAN, INTERNAL_X_MAX_POSTS_HARD_CAP),
  };
}

export type InternalXQueryBudgetOverride = {
  workspaceId: string;
  maxQueriesPerScan: number;
};

export function getInternalXQueryBudgetOverride(workspaceId: string | undefined): InternalXQueryBudgetOverride | null {
  if (!workspaceId) return null;
  const env = getServerEnv();
  const normalizedWorkspaceId = workspaceId.trim().toLowerCase();
  if (!parseWorkspaceIds(env.INTERNAL_X_DISCOVERY_WORKSPACE_IDS).has(normalizedWorkspaceId)) return null;
  if (!env.INTERNAL_X_MAX_QUERIES_PER_SCAN) return null;
  return {
    workspaceId: normalizedWorkspaceId,
    maxQueriesPerScan: Math.min(env.INTERNAL_X_MAX_QUERIES_PER_SCAN, INTERNAL_X_MAX_QUERIES_HARD_CAP),
  };
}

export function logInternalXDiscoveryOverride(input: {
  workspaceId: string;
  queryCount: number;
  maxPosts: number;
  postReadCostUsd: number;
}): void {
  console.log("[x] internal discovery override", {
    workspaceId: input.workspaceId,
    queryCount: input.queryCount,
    maxPosts: input.maxPosts,
    estimatedMaxCostUsd: estimateXReadCost(input.queryCount * input.maxPosts, input.postReadCostUsd),
  });
}
