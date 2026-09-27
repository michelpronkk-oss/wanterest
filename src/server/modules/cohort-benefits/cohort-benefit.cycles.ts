import type { BillingInterval } from "../billing/billing.schemas";

export type RemainingDiscountCyclesInput = {
  activatedAt: string;
  expiresAt: string;
  now: string;
  nextBillingAt: string;
  billingInterval: BillingInterval;
};

function addBillingInterval(date: Date, interval: BillingInterval): Date {
  const next = new Date(date.getTime());
  if (interval === "annual") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * Counts only billing anchors that are still in the future (or exactly now)
 * and strictly before the authoritative internal expiry timestamp.
 */
export function getRemainingEligibleDiscountCycles(input: RemainingDiscountCyclesInput): number {
  const now = Date.parse(input.now);
  const expiresAt = Date.parse(input.expiresAt);
  let cursor = new Date(Date.parse(input.nextBillingAt));
  if ([now, expiresAt, cursor.getTime()].some((value) => Number.isNaN(value)) || expiresAt <= now) return 0;

  while (cursor.getTime() < now) cursor = addBillingInterval(cursor, input.billingInterval);
  let cycles = 0;
  while (cursor.getTime() < expiresAt) {
    cycles += 1;
    cursor = addBillingInterval(cursor, input.billingInterval);
  }
  return cycles;
}

export function initialDiscountCycles(durationMonths: number, billingInterval: BillingInterval): number {
  if (!Number.isInteger(durationMonths) || durationMonths <= 0) throw new Error("Discount duration must be a positive integer.");
  if (billingInterval === "monthly") return durationMonths;
  if (durationMonths % 12 !== 0) throw new Error("Annual discount duration must be a whole number of years.");
  return durationMonths / 12;
}

