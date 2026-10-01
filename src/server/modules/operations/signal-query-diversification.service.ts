import "server-only";

import { sha256Json } from "@/server/modules/ingestion/hash";
import { buildQueryPlanSeedCandidatesV8, buildQueryPlanV8 } from "./query-planning-v8.service";
import type { QueryPlan, QueryPlanQuery, QueryPlanningInput } from "./query-planning.schemas";
import { diversifySignalQueries, exploreSignalQueriesV11, type SignalQueryHistoryRow } from "./signal-query-diversification.policy";

export function buildSignalDiversifiedQueryPlan(input: {
  planningInput: QueryPlanningInput;
  history: readonly SignalQueryHistoryRow[];
  historyState: "available" | "unavailable";
  explorationV11Enabled?: boolean;
}): { plan: QueryPlan; summary: ReturnType<typeof diversifySignalQueries>["summary"] | ReturnType<typeof exploreSignalQueriesV11>["summary"] } {
  const baseline = buildQueryPlanV8(input.planningInput);
  const selectedSourceKeys = baseline.source_plans.filter((source) => source.queries.length > 0).map((source) => source.source_key);
  const candidatePool = buildQueryPlanSeedCandidatesV8(input.planningInput, selectedSourceKeys);
  const args = {
    plan: baseline,
    planningInput: input.planningInput,
    candidatePool,
    history: input.history,
    historyState: input.historyState,
    fingerprintForQuery: (query: QueryPlanQuery) => sha256Json(query.query_id),
  };
  const v1 = diversifySignalQueries({ ...args, historyState: input.historyState });
  if (input.explorationV11Enabled && input.historyState === "available") {
    return exploreSignalQueriesV11({
      plan: v1.plan,
      planningInput: input.planningInput,
      candidatePool,
      history: input.history,
      fingerprintForQuery: args.fingerprintForQuery,
    });
  }
  return v1;
}
