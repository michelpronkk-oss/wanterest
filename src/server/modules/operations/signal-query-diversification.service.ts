import "server-only";

import { sha256Json } from "@/server/modules/ingestion/hash";
import { buildQueryPlanSeedCandidatesV8, buildQueryPlanV8 } from "./query-planning-v8.service";
import type { QueryPlan, QueryPlanningInput } from "./query-planning.schemas";
import { diversifySignalQueries, type SignalQueryHistoryRow } from "./signal-query-diversification.policy";

export function buildSignalDiversifiedQueryPlan(input: {
  planningInput: QueryPlanningInput;
  history: readonly SignalQueryHistoryRow[];
  historyState: "available" | "unavailable";
}): { plan: QueryPlan; summary: ReturnType<typeof diversifySignalQueries>["summary"] } {
  const baseline = buildQueryPlanV8(input.planningInput);
  const selectedSourceKeys = baseline.source_plans.filter((source) => source.queries.length > 0).map((source) => source.source_key);
  const candidatePool = buildQueryPlanSeedCandidatesV8(input.planningInput, selectedSourceKeys);
  return diversifySignalQueries({
    plan: baseline,
    planningInput: input.planningInput,
    candidatePool,
    history: input.history,
    historyState: input.historyState,
    fingerprintForQuery: (query) => sha256Json(query.query_id),
  });
}
