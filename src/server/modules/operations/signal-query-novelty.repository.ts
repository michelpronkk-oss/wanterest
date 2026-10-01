import "server-only";

import type { SignalQueryHistoryRow } from "./signal-query-diversification.policy";

type RpcClient = {
  rpc(name: "signal_query_novelty_history", args: {
    p_workspace_id: string;
    p_product_id: string;
    p_since: string;
    p_max_scans: number;
  }): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

function parseHistoryRows(value: unknown): SignalQueryHistoryRow[] {
  if (!Array.isArray(value) || value.length > 20_000) throw new Error("Signal-query history is unavailable.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Signal-query history is unavailable.");
    const row = entry as Record<string, unknown>;
    if (typeof row.query_plan_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(row.query_plan_fingerprint)
      || typeof row.scan_job_run_id !== "string"
      || typeof row.query_variant_version !== "string"
      || typeof row.execution_status !== "string"
      || !Number.isSafeInteger(row.unique_roots) || Number(row.unique_roots) < 0
      || !Number.isSafeInteger(row.new_root_attributions) || Number(row.new_root_attributions) < 0
      || !Number.isSafeInteger(row.new_independent_roots) || Number(row.new_independent_roots) < 0
      || typeof row.completed_at !== "string" || !Number.isFinite(Date.parse(row.completed_at))) {
      throw new Error("Signal-query history is unavailable.");
    }
    return {
      scanRunId: row.scan_job_run_id,
      queryPlanFingerprint: row.query_plan_fingerprint,
      queryVariantVersion: row.query_variant_version,
      executionStatus: row.execution_status,
      uniqueRoots: Number(row.unique_roots),
      newRootAttributions: Number(row.new_root_attributions),
      newIndependentRoots: Number(row.new_independent_roots),
      completedAt: row.completed_at,
    };
  });
}

/** Reads bounded aggregate query history. Query IDs remain hashed and server-only. */
export async function listSignalQueryNoveltyHistory(input: {
  client: unknown;
  workspaceId: string;
  productId: string;
  now?: Date;
}): Promise<SignalQueryHistoryRow[]> {
  const client = input.client as RpcClient;
  const now = input.now ?? new Date();
  const { data, error } = await client.rpc("signal_query_novelty_history", {
    p_workspace_id: input.workspaceId,
    p_product_id: input.productId,
    p_since: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    p_max_scans: 12,
  });
  if (error) throw new Error(`Signal-query history is unavailable (${error.code ?? "read_error"}).`);
  return parseHistoryRows(data);
}
