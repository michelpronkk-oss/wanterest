import { describe, expect, it } from "vitest";

import { AppError } from "../../src/server/lib/errors";
import {
  assertUsageWithinLimit,
  capabilityAllows,
} from "../../src/server/modules/entitlements/entitlement-policy";
import { consumeUsageInputSchema } from "../../src/server/modules/entitlements/entitlement.schemas";

describe("entitlement policy", () => {
  it("resolves boolean, numeric, and preview capabilities", () => {
    expect(capabilityAllows(true)).toBe(true);
    expect(capabilityAllows(false)).toBe(false);
    expect(capabilityAllows(0)).toBe(false);
    expect(capabilityAllows(5)).toBe(true);
    expect(capabilityAllows("preview")).toBe(true);
    expect(capabilityAllows("off")).toBe(false);
  });

  it("rejects disabled and over-limit usage", () => {
    expect(() => assertUsageWithinLimit({ capability: false, used: 0, amount: 1 })).toThrowError(
      AppError,
    );
    expect(() => assertUsageWithinLimit({ capability: 5, used: 4, amount: 2 })).toThrowError(
      AppError,
    );
    expect(() => assertUsageWithinLimit({ capability: 5, used: 4, amount: 1 })).not.toThrow();
  });

  it("validates usage type, positive amount, and idempotency", () => {
    expect(
      consumeUsageInputSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        usageType: "qualified_signal",
        amount: 1,
        idempotencyKey: "scan-1",
      }).success,
    ).toBe(true);
    expect(
      consumeUsageInputSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        usageType: "qualified_signal",
        amount: 0,
        idempotencyKey: "scan-1",
      }).success,
    ).toBe(false);
  });
});
