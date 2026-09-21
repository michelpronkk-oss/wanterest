import { describe, expect, it } from "vitest";

import { PRODUCT_DEMAND_SCAN_TASK_ID, resolveTriggerRuntimeConfig } from "../../src/server/providers/trigger/config";

describe("Trigger.dev dispatch configuration", () => {
  it("uses the v4 product-demand-scan task ID", () => {
    expect(PRODUCT_DEMAND_SCAN_TASK_ID).toBe("product-demand-scan");
  });

  it("requires a server-side environment key for remote dispatch", () => {
    expect(resolveTriggerRuntimeConfig({ localExecution: "remote", secretKey: "tr_dev_example" })).toMatchObject({
      executionMode: "remote",
      triggerConfigured: true,
      triggerSecretPresent: true,
    });
    expect(resolveTriggerRuntimeConfig({ localExecution: "remote" })).toMatchObject({
      executionMode: "remote",
      triggerConfigured: false,
      triggerSecretPresent: false,
    });
  });

  it("only permits direct execution when explicitly selected", () => {
    expect(resolveTriggerRuntimeConfig({ localExecution: "direct" })).toMatchObject({
      executionMode: "direct",
      triggerConfigured: true,
      triggerSecretPresent: false,
    });
    expect(resolveTriggerRuntimeConfig({ localExecution: "unexpected" })).toMatchObject({ executionMode: "remote", triggerConfigured: false });
  });
});
