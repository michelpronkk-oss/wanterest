export const X_POST_READ_COST_USD = 0.005;
export const X_COST_CONFIG_VERSION = "x-post-read-v1";
/** X recent search requires max_results >= 10 even when Wanterest surfaces fewer candidates. */
export const X_PROVIDER_MIN_RESULTS = 10;

export function estimateXReadCost(postCount: number, costPerPost = X_POST_READ_COST_USD): number {
  if (!Number.isFinite(postCount) || postCount < 0 || !Number.isFinite(costPerPost) || costPerPost < 0) {
    throw new Error("X read cost inputs must be finite and non-negative.");
  }
  return Number((postCount * costPerPost).toFixed(6));
}
