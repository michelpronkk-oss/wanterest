/** Presentation inputs only: callers obtain identities from an authorized backend read. */
export type AdmittedCohort = "founding_25" | "early_100";
/** Surface the identity sits on (Apex 2.0 board 03: light = ivory/white, dark = ink/near-black). */
export type IdentityTone = "light" | "dark";
/** Board 17/18: micro = plate (+ optional "#07"), compact = 22px pill, standard = 28px pill. */
export type BadgeSize = "micro" | "compact" | "standard";
export type AdmittedCohortPresentation = {
  cohort: AdmittedCohort;
  number: number;
  label: "Founding 25" | "Early 100";
  /** "#07" / "#042": compact serial with the approved digit count. */
  serial: string;
  /** "07" / "042": the oversized serial on cards and passes. */
  digits: string;
  limit: 25 | 100;
};
// Pre-admission identities deliberately cannot be supplied to CohortBadge.
export type EarlyAccessPresentation = { kind: "early_access"; number: number };
export type PriorityAccessPresentation = { kind: "priority_access"; status: "granted" | "revoked" };

export function admittedCohortLabel(cohort: AdmittedCohort): "Founding 25" | "Early 100" {
  if (cohort !== "founding_25" && cohort !== "early_100") throw new Error("Unknown admitted cohort.");
  return cohort === "founding_25" ? "Founding 25" : "Early 100";
}
/** Formats an existing authoritative number; it never allocates or infers one. */
export function admittedCohortPresentation(cohort: AdmittedCohort, number: number): AdmittedCohortPresentation {
  const limit = cohort === "founding_25" ? 25 : 100;
  if (!Number.isInteger(number) || number < 1 || number > limit) throw new Error("Invalid authoritative cohort identity.");
  const digits = String(number).padStart(cohort === "founding_25" ? 2 : 3, "0");
  return { cohort, number, label: admittedCohortLabel(cohort), serial: `#${digits}`, digits, limit };
}
/** "Sep 2026" (cards, compact rows). */
export function admissionMonth(assignedAt: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(assignedAt));
}
/** "September 2026" (Founder Pass rows, board 09/10/11). */
export function admissionMonthLong(assignedAt: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(assignedAt));
}
export function identityPixelSize(size = 48): number {
  if (!Number.isFinite(size) || size < 16 || size > 256) throw new Error("Identity size must be between 16 and 256 pixels.");
  return size;
}
/**
 * Board 04 monogram typography (Sora 600): 1 char 44% of the tile, 2 chars 36%,
 * 3 chars 28%. Characters are the persisted backend value, unmodified.
 */
export function monogramFontSize(value: string, size: number): number {
  const ratio = value.length <= 1 ? 0.44 : value.length === 2 ? 0.36 : 0.28;
  return Math.round(size * ratio * 10) / 10;
}
/**
 * Tile tone for a persisted monogram. The approved boards consistently render
 * one-character monograms on ink, two on ivory and three on neutral sand; this
 * is a presentation choice only and never alters the stored characters.
 */
export function monogramTone(value: string): "ink" | "ivory" | "neutral" {
  return value.length <= 1 ? "ink" : value.length === 2 ? "ivory" : "neutral";
}
