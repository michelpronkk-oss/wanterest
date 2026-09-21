import { schedules } from "@trigger.dev/sdk";

import { dispatchDueMonitoringSchedules } from "@/server/modules/monitoring/monitoring.service";

/**
 * Thin recurring control-plane tick. It only claims durable due rows; the
 * product-demand-scan task remains the existing execution boundary.
 */
export const automaticMonitoringSchedulerTask = schedules.task({
  id: "automatic-monitoring-scheduler",
  cron: { pattern: "*/15 * * * *", timezone: "UTC" },
  run: async (payload) => {
    const result = await dispatchDueMonitoringSchedules();
    return {
      ...result,
      scheduledAt: payload.timestamp,
    };
  },
});
