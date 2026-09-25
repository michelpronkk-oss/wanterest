import { z } from "zod";

/**
 * Wanterest Layer 11 measurement contract (`experiment_measurement_v1`).
 * The experiments row IS the frozen measurement plan; see docs/architecture.md Section 23.
 */

export const EXPERIMENT_MEASUREMENT_POLICY_VERSION = "experiment_measurement_v1" as const;
export const EXPERIMENT_OUTCOME_VERSION = "experiment_outcome_v1" as const;
export const EXPERIMENT_HYPOTHESIS_VERSION = "experiment_hypothesis_v1" as const;

/** Bounds (docs Section 23): enforced in SQL as well where they protect storage. */
export const EXPERIMENT_LIST_LIMIT = 100;
export const EXPERIMENT_OBSERVATION_LIMIT = 200;
export const EXPERIMENT_RESULT_REVISION_LIMIT = 100;
export const EXPERIMENT_MEASUREMENT_PASS_LIMIT = 50;
export const MANUAL_MEASUREMENT_GRACE_DAYS = 7;
/** Controlled splits finalize one day after the window to absorb the public event API's 24h lag. */
export const CONTROLLED_FINALIZE_LAG_DAYS = 1;

export const evidenceDesignSchema = z.enum(["controlled_split", "before_after"]);
export type EvidenceDesign = z.infer<typeof evidenceDesignSchema>;

/** Metric registry: six first-party conversion keys plus one labelled manual metric. */
export const CONVERSION_METRIC_KEYS = ["cta_click", "signup_started", "signup_completed", "demo_requested", "checkout_started", "purchase_completed"] as const;
export const conversionMetricSchema = z.enum(CONVERSION_METRIC_KEYS);
export const measurementMetricSchema = z.enum([...CONVERSION_METRIC_KEYS, "manual_custom"]);
export type MeasurementMetric = z.infer<typeof measurementMetricSchema>;
export const metricUnitSchema = z.enum(["count", "rate", "currency"]);
export type MetricUnit = z.infer<typeof metricUnitSchema>;
/** Market intelligence is context only and never a primary metric. */
export const CONTEXT_METRIC_KEY = "market_evidence_count" as const;

export const measurementWindowSchema = z.enum(["7d", "30d", "90d"]);
export type MeasurementWindow = z.infer<typeof measurementWindowSchema>;
export const MEASUREMENT_WINDOW_DAYS: Record<MeasurementWindow, number> = { "7d": 7, "30d": 30, "90d": 90 };

export const successCriterionSchema = z.object({
  direction: z.enum(["increase", "decrease"]),
  measure: z.enum(["absolute_delta", "relative_delta"]),
  /** Human-supplied; there is no system default. */
  minimumEffect: z.number().positive().finite(),
  /** Human-supplied for controlled splits; forbidden for before/after. */
  minSamplePerArm: z.number().int().min(1).max(1_000_000).optional(),
}).strict();
export type SuccessCriterion = z.infer<typeof successCriterionSchema>;

export const EXPERIMENT_CLOSED_REASONS = [
  "canceled_before_treatment", "treatment_started_before_registration", "measurement_disabled_at_treatment",
  "action_closed_before_treatment", "treatment_abandoned", "window_elapsed", "stopped_early",
] as const;
export type ExperimentClosedReason = (typeof EXPERIMENT_CLOSED_REASONS)[number];

export const EXPERIMENT_OUTCOMES = ["positive", "negative", "neutral", "inconclusive", "invalid"] as const;
export type ExperimentOutcome = (typeof EXPERIMENT_OUTCOMES)[number];
export const ATTRIBUTION_CLASSES = ["none", "descriptive", "before_after_association", "controlled_comparison"] as const;
export type AttributionClass = (typeof ATTRIBUTION_CLASSES)[number];
export const TREATMENT_INTEGRITY = ["unconfirmed", "confirmed", "verified_exposure"] as const;
export type TreatmentIntegrity = (typeof TREATMENT_INTEGRITY)[number];
export const INCONCLUSIVE_REASONS = [
  "missing_baseline", "insufficient_baseline", "missing_observation", "window_interrupted", "sample_below_minimum",
  "treatment_unconfirmed", "treatment_not_live_full_window", "zero_denominator", "effect_not_computable", "partial_data",
] as const;
export type InconclusiveReason = (typeof INCONCLUSIVE_REASONS)[number];

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/**
 * Browser input to create a measurement plan from one approved Action. The
 * browser never supplies a workspace, product, fingerprint or idempotency key:
 * scope is derived from the Action through RLS, the rest is computed server-side.
 */
const measurementPlanBaseSchema = z.object({
  actionId: uuid,
  design: evidenceDesignSchema,
  primaryMetric: measurementMetricSchema,
  metricLabel: optionalText(120),
  metricUnit: metricUnitSchema.optional(),
  measurementWindow: measurementWindowSchema,
  washoutDays: z.number().int().min(0).max(14),
  successCriterion: successCriterionSchema,
  intervention: z.string().trim().min(1).max(500),
  name: optionalText(200),
  targetPagePath: optionalText(500),
  targetKey: optionalText(200),
}).strict();

type PlanShape = Omit<z.infer<typeof measurementPlanBaseSchema>, "actionId">;

/** Design-specific plan rules (shared by create and draft edits; mirrored by the SQL check). */
export function measurementPlanIssues(plan: PlanShape): Array<{ message: string; path: string[] }> {
  const issues: Array<{ message: string; path: string[] }> = [];
  if (plan.design === "controlled_split") {
    if (plan.primaryMetric === "manual_custom") issues.push({ message: "A controlled split measures one first-party conversion key.", path: ["primaryMetric"] });
    if (plan.successCriterion.minSamplePerArm === undefined) issues.push({ message: "A controlled split needs a minimum sample per arm.", path: ["successCriterion", "minSamplePerArm"] });
    if (!plan.targetPagePath || !plan.targetKey) issues.push({ message: "A controlled split needs a target page path and key.", path: ["targetPagePath"] });
  } else if (plan.successCriterion.minSamplePerArm !== undefined) {
    issues.push({ message: "A before/after measurement has no arms.", path: ["successCriterion", "minSamplePerArm"] });
  }
  if (plan.primaryMetric === "manual_custom") {
    if (!plan.metricLabel || !plan.metricUnit) issues.push({ message: "A custom metric needs a label and a unit.", path: ["metricLabel"] });
  } else if (plan.metricLabel || plan.metricUnit) {
    issues.push({ message: "Only a custom metric carries its own label and unit.", path: ["metricLabel"] });
  }
  return issues;
}

/**
 * Browser input to create a measurement plan from one approved Action. The
 * browser never supplies a workspace, product, fingerprint or idempotency key:
 * scope is derived from the Action through RLS, the rest is computed server-side.
 */
export const createMeasurementPlanRequestSchema = measurementPlanBaseSchema.superRefine((plan, ctx) => {
  for (const issue of measurementPlanIssues(plan)) ctx.addIssue({ code: "custom", ...issue });
});
export type CreateMeasurementPlanRequest = z.infer<typeof createMeasurementPlanRequestSchema>;

/** Draft edits resubmit the full plan for the same experiment (design is fixed at creation). */
export const updateMeasurementDraftRequestSchema = z.object({
  experimentId: uuid,
  plan: measurementPlanBaseSchema.omit({ actionId: true, design: true }),
}).strict();
export type UpdateMeasurementDraftRequest = z.infer<typeof updateMeasurementDraftRequestSchema>;

export const experimentIdRequestSchema = z.object({ experimentId: uuid }).strict();
export const cancelExperimentRequestSchema = z.object({ experimentId: uuid, note: optionalText(1_000) }).strict();
export const revokeExperimentTokenRequestSchema = z.object({ experimentId: uuid, tokenId: uuid }).strict();
export const addMeasurementVariantRequestSchema = z.object({
  experimentId: uuid,
  variantKey: z.string().regex(/^[a-z][a-z0-9_-]{0,80}$/),
  label: z.string().trim().min(1).max(200),
  content: z.record(z.string(), z.json()),
  allocationWeight: z.number().int().min(1).max(10_000),
  isControl: z.boolean(),
  sourceActionVariantId: uuid.optional(),
}).strict();

/**
 * A manual value for the frozen baseline or measurement window. The period is
 * never supplied by the browser; it is the plan's frozen window.
 */
export const recordManualObservationRequestSchema = z.object({
  experimentId: uuid,
  windowRole: z.enum(["baseline", "measurement"]),
  value: z.number().finite().min(0),
  denominator: z.number().finite().min(0).optional(),
  note: optionalText(1_000),
  supersedesObservationId: uuid.optional(),
  /** Client retry key; defaults to a server-derived one. */
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
}).strict();
export type RecordManualObservationRequest = z.infer<typeof recordManualObservationRequestSchema>;
