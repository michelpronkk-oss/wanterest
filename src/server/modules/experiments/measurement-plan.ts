import type { ActionRow } from "../../db/database.helpers";
import type { Json } from "../../db/database.types";
import { sha256Json } from "../ingestion/hash";
import {
  EXPERIMENT_HYPOTHESIS_VERSION, EXPERIMENT_MEASUREMENT_POLICY_VERSION, MEASUREMENT_WINDOW_DAYS,
  type CreateMeasurementPlanRequest, type EvidenceDesign, type MeasurementMetric, type MeasurementWindow, type MetricUnit, type SuccessCriterion,
} from "./measurement.schemas";

/** The structured, versioned hypothesis; the stored sentence is derived from it. */
export type StructuredHypothesis = {
  hypothesisVersion: typeof EXPERIMENT_HYPOTHESIS_VERSION;
  actionId: string;
  proposalFingerprint: string;
  clusteringVersion: string | null;
  anchorConceptKey: string;
  actionType: string;
  targetKey: string;
  intervention: string;
  primaryMetric: MeasurementMetric;
  metricLabel: string | null;
  expectedDirection: SuccessCriterion["direction"];
  measurementWindow: MeasurementWindow;
  washoutDays: number;
  successCriterion: SuccessCriterion;
};

export type MeasurementPlanFields = Omit<CreateMeasurementPlanRequest, "actionId">;

export type BuiltMeasurementPlan = {
  name: string;
  hypothesis: string;
  experimentType: string;
  hypothesisStructured: StructuredHypothesis;
  planFingerprint: string;
  idempotencyKey: string;
  minSampleSize: number;
};

const EXPERIMENT_TYPE_BY_ACTION: Record<string, string> = {
  messaging_change: "messaging_test", content_angle: "messaging_test", campaign_angle: "messaging_test",
  landing_page: "landing_page_test", comparison_page: "positioning_test", positioning_change: "positioning_test",
  offer_hypothesis: "offer_test", onboarding_change: "onboarding_test",
};

export function metricDisplayName(metric: MeasurementMetric | string, label?: string | null): string {
  return metric === "manual_custom" && label ? label : metric.replaceAll("_", " ");
}

/** Creation identity: one Action + one exact plan. A materially different plan is a different experiment. */
export function experimentIdempotencyKey(actionId: string, planFingerprint: string): string {
  return `experiment:${actionId}:${planFingerprint}`;
}

/** Deterministic fingerprint over every frozen plan field (and the treated proposal). */
export function measurementPlanFingerprint(action: Pick<ActionRow, "id" | "proposal_fingerprint">, design: EvidenceDesign, plan: Omit<MeasurementPlanFields, "design">): string {
  return sha256Json({
    policyVersion: EXPERIMENT_MEASUREMENT_POLICY_VERSION,
    actionId: action.id,
    proposalFingerprint: action.proposal_fingerprint,
    design,
    primaryMetric: plan.primaryMetric,
    metricLabel: plan.metricLabel ?? null,
    metricUnit: plan.metricUnit ?? null,
    measurementWindow: plan.measurementWindow,
    washoutDays: plan.washoutDays,
    successCriterion: { direction: plan.successCriterion.direction, measure: plan.successCriterion.measure, minimumEffect: plan.successCriterion.minimumEffect, minSamplePerArm: plan.successCriterion.minSamplePerArm ?? null },
    intervention: plan.intervention,
    name: plan.name ?? null,
    targetPagePath: plan.targetPagePath ?? null,
    targetKey: plan.targetKey ?? null,
  });
}

export function hypothesisSentence(h: StructuredHypothesis): string {
  const days = MEASUREMENT_WINDOW_DAYS[h.measurementWindow];
  const effect = h.successCriterion.measure === "relative_delta" ? `${h.successCriterion.minimumEffect * 100}% (relative)` : `${h.successCriterion.minimumEffect} (absolute)`;
  const washout = h.washoutDays > 0 ? ` after a ${h.washoutDays}-day washout` : "";
  return `If we ${h.intervention}, ${metricDisplayName(h.primaryMetric, h.metricLabel)} is expected to ${h.expectedDirection} by at least ${effect} over the ${days} days${washout} after the change goes live.`.slice(0, 2_000);
}

export function buildMeasurementPlan(action: ActionRow, design: EvidenceDesign, plan: Omit<MeasurementPlanFields, "design">): BuiltMeasurementPlan {
  if (!action.proposal_fingerprint) throw new Error("measurement_plan_requires_proposal_fingerprint");
  const hypothesisStructured: StructuredHypothesis = {
    hypothesisVersion: EXPERIMENT_HYPOTHESIS_VERSION,
    actionId: action.id,
    proposalFingerprint: action.proposal_fingerprint,
    clusteringVersion: action.trigger_clustering_version,
    anchorConceptKey: action.trigger_concept_key,
    actionType: action.action_type,
    targetKey: action.target_key,
    intervention: plan.intervention,
    primaryMetric: plan.primaryMetric,
    metricLabel: plan.metricLabel ?? null,
    expectedDirection: plan.successCriterion.direction,
    measurementWindow: plan.measurementWindow,
    washoutDays: plan.washoutDays,
    successCriterion: plan.successCriterion,
  };
  const planFingerprint = measurementPlanFingerprint(action, design, plan);
  return {
    name: (plan.name ?? `Measure: ${action.title}`).slice(0, 200),
    hypothesis: hypothesisSentence(hypothesisStructured),
    experimentType: EXPERIMENT_TYPE_BY_ACTION[action.action_type] ?? "messaging_test",
    hypothesisStructured,
    planFingerprint,
    idempotencyKey: experimentIdempotencyKey(action.id, planFingerprint),
    minSampleSize: plan.successCriterion.minSamplePerArm ?? 1,
  };
}

/** Row payload for the `create_experiment` / `update_experiment_draft` RPCs (snake_case columns). */
export function planColumns(design: EvidenceDesign, plan: Omit<MeasurementPlanFields, "design">, built: BuiltMeasurementPlan): Record<string, Json> {
  const metricUnit: MetricUnit | null = plan.metricUnit ?? null;
  return {
    name: built.name,
    hypothesis: built.hypothesis,
    experiment_type: built.experimentType,
    primary_metric: plan.primaryMetric,
    metric_source: design === "controlled_split" ? "experiment_events" : "manual",
    metric_label: plan.metricLabel ?? null,
    metric_unit: metricUnit,
    measurement_window: plan.measurementWindow,
    washout_days: plan.washoutDays,
    success_criterion: { ...plan.successCriterion } as Json,
    hypothesis_structured: built.hypothesisStructured as unknown as Json,
    target_page_path: plan.targetPagePath ?? null,
    target_key: plan.targetKey ?? null,
    min_sample_size: built.minSampleSize,
    measurement_plan_fingerprint: built.planFingerprint,
  };
}
