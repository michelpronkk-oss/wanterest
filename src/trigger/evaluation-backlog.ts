import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { processEvaluationBacklogBatch } from "@/server/modules/operations/evaluation-backlog.processor";

export const processEvaluationBacklogTask = schemaTask({
  id: "process-evaluation-backlog",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 60_000, factor: 2 },
  maxDuration: 900,
  schema: z.object({}),
  run: async () => {
    const result = await processEvaluationBacklogBatch(undefined, async () => {
      await processEvaluationBacklogTask.trigger({}, { delay: new Date(Date.now() + 21 * 60_000) });
    });
    if (result.nextWakeAt) {
      const delay = new Date(Math.max(Date.now() + 30_000, Date.parse(result.nextWakeAt)));
      await processEvaluationBacklogTask.trigger({}, { delay });
    }
    return result;
  },
});
