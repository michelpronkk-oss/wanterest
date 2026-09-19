import { AppError } from "../../lib/errors";
import type { EntitlementValue } from "./entitlement.schemas";

export function capabilityAllows(value: EntitlementValue | null): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return !["disabled", "none", "off"].includes(value);
}

export function assertUsageWithinLimit(input: {
  capability: EntitlementValue | null;
  used: number;
  amount: number;
}) {
  if (input.amount <= 0) {
    throw new AppError("VALIDATION_ERROR", "Usage amount must be positive.");
  }
  if (input.capability === null) {
    throw new AppError("INTERNAL_ERROR", "The workspace entitlement is not resolved.");
  }
  if (typeof input.capability === "boolean" && !input.capability) {
    throw new AppError("CAPABILITY_DISABLED", "This workspace capability is not enabled.");
  }
  if (
    typeof input.capability === "number" &&
    input.used + input.amount > input.capability
  ) {
    throw new AppError("USAGE_LIMIT_EXCEEDED", "The workspace usage limit was reached.");
  }
}
