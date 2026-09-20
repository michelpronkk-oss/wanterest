import type { ExperimentService } from "../../modules/experiments";

export const EXPERIMENT_JOB_TYPES = ["aggregate-experiment-results", "finalize-experiment", "backfill-experiment-results"] as const;
export type ExperimentJobType = (typeof EXPERIMENT_JOB_TYPES)[number];

export function experimentResultJobIdempotency(experimentId: string, revision: number) { return `experiment-results:${experimentId}:${revision}`; }
export function runAggregateExperimentResultsJob(service: ExperimentService, workspaceId: string, experimentId: string) { return service.calculateResults(workspaceId, experimentId); }
export function runFinalizeExperimentJob(service: ExperimentService, workspaceId: string, experimentId: string) { return service.transition({ workspaceId, experimentId, toStatus: "completed" }); }
export async function runBackfillExperimentResultsJob(service: ExperimentService, input: { workspaceId: string; experimentIds: string[]; limit?: number; cursor?: number; dryRun?: boolean }) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const ids = input.experimentIds.slice(input.cursor ?? 0, (input.cursor ?? 0) + limit);
  if (input.dryRun) return { processed: 0, eligible: ids.length, nextCursor: (input.cursor ?? 0) + ids.length };
  const results = [];
  for (const id of ids) results.push(await service.calculateResults(input.workspaceId, id));
  return { processed: results.length, results, nextCursor: (input.cursor ?? 0) + results.length };
}
