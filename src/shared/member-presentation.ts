/** Presentation inputs only: callers obtain identities from an authorized backend read. */
export type AdmittedCohort = "founding_25" | "early_100";
export type IdentityTone = "light" | "dark";
export type BadgeSize = "compact" | "standard" | "large";
export type AdmittedCohortPresentation = {
  cohort: AdmittedCohort; number: number; label: "Founding 25" | "Early 100"; serial: string;
};
// Pre-admission identities deliberately cannot be supplied to CohortBadge.
export type EarlyAccessPresentation = { kind: "early_access"; number: number };
export type PriorityAccessPresentation = { kind: "priority_access"; status: "granted" | "revoked" };

export function admittedCohortLabel(cohort: AdmittedCohort): "Founding 25" | "Early 100" {
  if (cohort !== "founding_25" && cohort !== "early_100") throw new Error("Unknown admitted cohort.");
  return cohort === "founding_25" ? "Founding 25" : "Early 100";
}
export function admittedCohortPresentation(cohort: AdmittedCohort, number: number): AdmittedCohortPresentation {
  if (!Number.isInteger(number) || number < 1 || number > (cohort === "founding_25" ? 25 : 100)) throw new Error("Invalid authoritative cohort identity.");
  return { cohort, number, label: admittedCohortLabel(cohort), serial: `#${String(number).padStart(cohort === "founding_25" ? 2 : 3, "0")}` };
}
export function admissionMonth(assignedAt: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(assignedAt));
}
export function identityPixelSize(size = 48): number {
  if (!Number.isFinite(size) || size < 16 || size > 256) throw new Error("Identity size must be between 16 and 256 pixels.");
  return size;
}
