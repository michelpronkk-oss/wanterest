import { schedules } from "@trigger.dev/sdk";

import { deliverPendingMonitoringNotifications } from "@/server/modules/monitoring/monitoring.notifications";

export const monitoringNotificationDeliveryTask = schedules.task({
  id: "monitoring-notification-delivery",
  cron: { pattern: "*/15 * * * *", timezone: "UTC" },
  run: async () => deliverPendingMonitoringNotifications(),
});
