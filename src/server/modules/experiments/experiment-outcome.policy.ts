import { sha256Json } from "../ingestion/hash";
import { metricDisplayName } from "./measurement-plan";
import {
  EXPERIMENT_OUTCOME_VERSION,
  type AttributionClass, type EvidenceDesign, type ExperimentOutcome, type InconclusiveReason, type MetricUnit, type SuccessCriterion, type TreatmentIntegrity,
} from "./measurement.schemas";

/**
 * Deterministic outcome policy `experiment_outcome_v1` (no LLM, no statistics
 * engine). Invalid/inconclusive rules apply first; attribution is capped by
 * design and treatment integrity; wording never claims causality, validation
 * or significance. See docs/architecture.md Section 23.
 */

export type ObservedValue = { id: string; value: number; denominator: number | null };
export type ArmCount = { variantId: string; isControl: boolean; exposed: number; converted: number; excludedEvents: number };

export type OutcomeInput = {
  experimentId: string;
  planFingerprint: string;
  design: EvidenceDesign;
  primaryMetric: string;
  metricLabel: string | null;
  metricUnit: MetricUnit | null;
  successCriterion: SuccessCriterion;
  /** Experiment lifecycle state at evaluation. */
  status: "running" | "completed" | "canceled";
  closedReason: string | null;
  treatment: { actionStatus: string; liveSince: string | null; measurementStart: string; measurementEnd: string };
  /** Before/after: the 7-day manual grace after the window has passed. */
  graceExpired: boolean;
  baseline: ObservedValue | null;
  measurement: ObservedValue | null;
  arms: ArmCount[];
  windowDays: number;
  daysWithExposure: number;
};

export type ArmResult = ArmCount & { rate: number | null };

export type OutcomeResult = {
  outcomeVersion: typeof EXPERIMENT_OUTCOME_VERSION;
  outcome: ExperimentOutcome;
  attributionClass: AttributionClass;
  treatmentIntegrity: TreatmentIntegrity;
  evidenceCompleteness: "complete" | "partial" | "missing";
  inconclusiveReasons: InconclusiveReason[];
  invalidationReason: string | null;
  baselineValue: number | null;
  observedValue: number | null;
  effect: number | null;
  effectBasis: SuccessCriterion["measure"] | null;
  armResults: ArmResult[] | null;
  summary: string;
  inputFingerprint: string;
  observationIds: string[];
};

/** Result copy vocabulary that must never appear in Layer 11 output. */
export const FORBIDDEN_RESULT_WORDS = ["winner", "proven", "validated", "significant", "caused", "statistically better", "outperformed", "lift"] as const;
export const CONTROLLED_MET_COPY = "Observed randomized comparison met the pre-registered effect threshold.";
export const CONTROLLED_NOT_MET_COPY = "Observed randomized comparison did not meet the pre-registered effect threshold.";
export const NOT_STATISTICALLY_TESTED_COPY = "Not statistically tested.";

const REASON_COPY: Record<InconclusiveReason, string> = {
  missing_baseline: "no baseline value for the frozen baseline window",
  insufficient_baseline: "the baseline is zero, so a relative change cannot be computed",
  missing_observation: "no value was recorded for the measurement window",
  window_interrupted: "measurement stopped before the window ended",
  sample_below_minimum: "an arm is below the pre-registered minimum sample",
  treatment_unconfirmed: "the change was not confirmed live",
  treatment_not_live_full_window: "the change went live after the measurement window began",
  zero_denominator: "a rate has a zero denominator",
  effect_not_computable: "the change could not be computed",
  partial_data: "some window days have no data",
};

const round = (value: number) => Math.round(value * 1e10) / 1e10;
const valueOf = (o: ObservedValue | null): number | null => {
  if (!o) return null;
  if (o.denominator === null) return o.value;
  return o.denominator > 0 ? o.value / o.denominator : null;
};
const rateOf = (arm: ArmCount): number | null => (arm.exposed > 0 ? arm.converted / arm.exposed : null);
const pct = (value: number | null) => (value === null ? "n/a" : `${round(value * 100)}%`);
const num = (value: number | null) => (value === null ? "n/a" : String(round(value)));

function effectOf(criterion: SuccessCriterion, before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  if (criterion.measure === "absolute_delta") return round(after - before);
  return before === 0 ? null : round((after - before) / before);
}

function integrityOf(input: OutcomeInput, treatmentArm: ArmCount | undefined): TreatmentIntegrity {
  if (input.design === "controlled_split" && treatmentArm && treatmentArm.exposed > 0) return "verified_exposure";
  return input.treatment.actionStatus === "completed" && input.treatment.liveSince ? "confirmed" : "unconfirmed";
}

export function computeExperimentOutcome(input: OutcomeInput): OutcomeResult {
  const control = input.arms.find((arm) => arm.isControl);
  const treatmentArm = input.arms.find((arm) => !arm.isControl);
  const treatmentIntegrity = integrityOf(input, treatmentArm);
  const armResults = input.design === "controlled_split" ? input.arms.map((arm) => ({ ...arm, rate: rateOf(arm) })) : null;
  const observationIds = input.design === "before_after" ? [input.baseline?.id, input.measurement?.id].filter((id): id is string => Boolean(id)) : [];
  // Only outcome-determining inputs: a running→completed lifecycle step or the
  // clock crossing the grace boundary alone never yields a new revision; late
  // treatment confirmation or an observation correction does.
  const inputFingerprint = sha256Json({
    outcomeVersion: EXPERIMENT_OUTCOME_VERSION, experimentId: input.experimentId, planFingerprint: input.planFingerprint,
    interruption: input.status === "canceled" ? input.closedReason : null,
    treatmentConfirmed: treatmentIntegrity, liveSince: treatmentIntegrity === "confirmed" ? input.treatment.liveSince : null,
    baseline: input.baseline, measurement: input.measurement,
    arms: input.arms.map((arm) => ({ ...arm })).sort((a, b) => a.variantId.localeCompare(b.variantId)),
    windowDays: input.windowDays, daysWithExposure: input.daysWithExposure,
  });
  const base = { outcomeVersion: EXPERIMENT_OUTCOME_VERSION, treatmentIntegrity, armResults, inputFingerprint, observationIds, effectBasis: input.successCriterion.measure } as const;

  // 1) invalid first
  if (input.closedReason === "treatment_abandoned") {
    return {
      ...base, outcome: "invalid", attributionClass: "none", evidenceCompleteness: "missing", inconclusiveReasons: [], invalidationReason: "treatment_abandoned",
      baselineValue: null, observedValue: null, effect: null, effectBasis: null,
      summary: "Measurement invalid: the change was abandoned during the measurement window.",
    };
  }

  // 2) values, completeness, and every applicable inconclusive reason
  const reasons = new Set<InconclusiveReason>();
  if (input.status === "canceled") reasons.add("window_interrupted");
  let baselineValue: number | null;
  let observedValue: number | null;
  let evidenceCompleteness: OutcomeResult["evidenceCompleteness"];
  if (input.design === "before_after") {
    baselineValue = valueOf(input.baseline);
    observedValue = valueOf(input.measurement);
    evidenceCompleteness = input.baseline && input.measurement ? "complete" : input.baseline || input.measurement ? "partial" : "missing";
    if (!input.baseline) reasons.add("missing_baseline");
    if (!input.measurement) reasons.add("missing_observation");
    if ((input.baseline?.denominator === 0) || (input.measurement?.denominator === 0)) reasons.add("zero_denominator");
    if (input.successCriterion.measure === "relative_delta" && baselineValue === 0) reasons.add("insufficient_baseline");
    if (treatmentIntegrity === "unconfirmed") reasons.add("treatment_unconfirmed");
    if (input.treatment.liveSince && new Date(input.treatment.liveSince).getTime() > new Date(input.treatment.measurementStart).getTime()) reasons.add("treatment_not_live_full_window");
  } else {
    baselineValue = control ? rateOf(control) : null;
    observedValue = treatmentArm ? rateOf(treatmentArm) : null;
    const anyExposure = input.arms.some((arm) => arm.exposed > 0);
    evidenceCompleteness = !anyExposure ? "missing" : input.daysWithExposure >= input.windowDays && control && treatmentArm && control.exposed > 0 && treatmentArm.exposed > 0 ? "complete" : "partial";
    if (!control || !treatmentArm || control.exposed === 0 || treatmentArm.exposed === 0) reasons.add("zero_denominator");
    const minimum = input.successCriterion.minSamplePerArm ?? 1;
    if (input.arms.some((arm) => arm.exposed < minimum) || input.arms.length < 2) reasons.add("sample_below_minimum");
    if (evidenceCompleteness !== "complete") reasons.add("partial_data");
    if (input.successCriterion.measure === "relative_delta" && baselineValue === 0) reasons.add("insufficient_baseline");
    if (treatmentIntegrity !== "verified_exposure") reasons.add("treatment_unconfirmed");
  }
  const effect = effectOf(input.successCriterion, baselineValue, observedValue);
  if (effect === null && reasons.size === 0) reasons.add("effect_not_computable");
  const metric = metricDisplayName(input.primaryMetric, input.metricLabel);
  const show = input.design === "controlled_split" ? pct : num;

  if (reasons.size > 0) {
    const inconclusiveReasons = [...reasons];
    return {
      ...base, outcome: "inconclusive", attributionClass: observedValue !== null ? "descriptive" : "none",
      evidenceCompleteness,
      inconclusiveReasons, invalidationReason: null, baselineValue, observedValue, effect,
      summary: `Not enough evidence to judge this change: ${inconclusiveReasons.map((reason) => REASON_COPY[reason]).join("; ")}.${observedValue !== null ? ` Observed ${metric}: ${show(observedValue)}.` : ""}`,
    };
  }

  // 3) direction vs the pre-registered threshold
  const expectedSign = input.successCriterion.direction === "increase" ? 1 : -1;
  const meetsSize = Math.abs(effect!) + 1e-12 >= input.successCriterion.minimumEffect;
  const outcome: ExperimentOutcome = meetsSize && Math.sign(effect!) === expectedSign ? "positive" : meetsSize && Math.sign(effect!) === -expectedSign ? "negative" : "neutral";

  if (input.design === "controlled_split") {
    const arms = `Treatment: ${treatmentArm!.converted} of ${treatmentArm!.exposed} exposed (${pct(observedValue)}); control: ${control!.converted} of ${control!.exposed} exposed (${pct(baselineValue)}).`;
    const opposite = outcome === "negative" ? " The observed difference ran opposite to the expected direction." : "";
    return {
      ...base, outcome, attributionClass: "controlled_comparison", evidenceCompleteness, inconclusiveReasons: [], invalidationReason: null,
      baselineValue, observedValue, effect,
      summary: `${outcome === "positive" ? CONTROLLED_MET_COPY : CONTROLLED_NOT_MET_COPY}${opposite} ${NOT_STATISTICALLY_TESTED_COPY} ${arms}`,
    };
  }
  const relation = outcome === "positive" ? "meeting the pre-registered threshold" : outcome === "negative" ? "moving opposite to the expected direction by at least the pre-registered threshold" : "within the pre-registered threshold";
  return {
    ...base, outcome, attributionClass: "before_after_association", evidenceCompleteness, inconclusiveReasons: [], invalidationReason: null,
    baselineValue, observedValue, effect,
    summary: `After the change, ${metric} was ${show(observedValue)} vs ${show(baselineValue)} in the baseline window, ${relation}. Manual values; this is an association and other factors may have contributed.`,
  };
}
