import { schedules } from "@trigger.dev/sdk";

import { runExperimentMeasurementPass } from "@/server/modules/experiments/measurement-pass";

/**
 * Wanterest Layer 11: daily experiment measurement pass. Finalizes due
 * measurement-v1 experiments (≤ 50 per run) into append-only outcome
 * revisions. Runs regardless of EXPERIMENT_MEASUREMENT_ENABLED (draining);
 * with no due experiments it does zero writes.
 */
export const experimentMeasurementPassTask = schedules.task({
  id: "experiment-measurement-pass",
  cron: { pattern: "23 4 * * *", timezone: "UTC" },
  queue: { name: "experiment-measurement", concurrencyLimit: 1 },
  maxDuration: 600,
  run: async (payload) => {
    const result = await runExperimentMeasurementPass();
    if (result.failed > 0 && result.finalized === 0) throw new Error(`Experiment measurement pass failed for ${result.failed} due experiment(s).`);
    return { ...result, scheduledAt: payload.timestamp };
  },
});
