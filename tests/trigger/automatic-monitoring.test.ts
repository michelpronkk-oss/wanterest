import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scheduler = readFileSync(resolve(process.cwd(), "src/trigger/automatic-monitoring.ts"), "utf8");
const notifications = readFileSync(resolve(process.cwd(), "src/trigger/monitoring-notifications.ts"), "utf8");

describe("Automatic Monitoring Trigger contracts", () => {
  it("registers a UTC recurring scheduler that delegates to the durable claim service", () => {
    expect(scheduler).toContain('id: "automatic-monitoring-scheduler"');
    expect(scheduler).toContain('pattern: "*/15 * * * *"');
    expect(scheduler).toContain('timezone: "UTC"');
    expect(scheduler).toContain("dispatchDueMonitoringSchedules");
  });

  it("registers notification delivery as a separate bounded schedule", () => {
    expect(notifications).toContain('id: "monitoring-notification-delivery"');
    expect(notifications).toContain('pattern: "*/15 * * * *"');
    expect(notifications).toContain("deliverPendingMonitoringNotifications");
  });
});
