import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import type { ActionRow, ExperimentObservationRow, ExperimentRow } from "../../db/database.helpers";
import type { Json } from "../../db/database.types";
import { AppError } from "../../lib/errors";
import { sha256Json } from "../ingestion/hash";
import { ACTION_MUTATING_ROLES, type ActionAccess, type WorkspaceRole } from "../actions/action-lifecycle.service";
import { computeExperimentOutcome, type ArmCount, type ObservedValue, type OutcomeResult } from "./experiment-outcome.policy";
import { buildMeasurementPlan, planColumns } from "./measurement-plan";
import type { MeasurementRepository } from "./measurement.repository";
import {
  CONTEXT_METRIC_KEY, CONTROLLED_FINALIZE_LAG_DAYS, EXPERIMENT_MEASUREMENT_PASS_LIMIT, EXPERIMENT_MEASUREMENT_POLICY_VERSION,
  MANUAL_MEASUREMENT_GRACE_DAYS, MEASUREMENT_WINDOW_DAYS, addMeasurementVariantRequestSchema, cancelExperimentRequestSchema,
  createMeasurementPlanRequestSchema, measurementPlanIssues, recordManualObservationRequestSchema, revokeExperimentTokenRequestSchema,
  updateMeasurementDraftRequestSchema, type EvidenceDesign, type MeasurementWindow, type MetricUnit, type SuccessCriterion,
} from "./measurement.schemas";

/**
 * Wanterest Layer 11 experiment measurement lifecycle.
 *
 * Authorization contract (fixes the Phase 7 IDOR class): an experiment is
 * loaded through the caller's RLS-scoped client, its own workspace is the only
 * scope ever used, membership and role are verified before any service-role
 * RPC, and the RPC re-checks the actor in its own transaction. A browser
 * workspace id authorizes nothing. See docs/architecture.md Section 23.
 */

export type ExperimentAccessPorts = {
  currentUser(): Promise<{ id: string } | null>;
  /** RLS/user-scoped read: null for non-existent AND for other tenants' experiments. */
  loadExperimentAsUser(experimentId: string): Promise<ExperimentRow | null>;
  loadMembershipAsUser(workspaceId: string, userId: string): Promise<{ role: string; status: string } | null>;
};

export type ExperimentAccess = { userId: string; experiment: ExperimentRow; role: WorkspaceRole; canMutate: boolean };

export async function authorizeExperimentAccess(ports: ExperimentAccessPorts, experimentId: unknown, mode: "read" | "mutate"): Promise<ExperimentAccess> {
  const user = await ports.currentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Authentication is required.");
  const parsedId = z.string().uuid().safeParse(experimentId);
  if (!parsedId.success) throw new AppError("NOT_FOUND", "Experiment was not found.");
  const experiment = await ports.loadExperimentAsUser(parsedId.data);
  if (!experiment) throw new AppError("NOT_FOUND", "Experiment was not found.");
  const membership = await ports.loadMembershipAsUser(experiment.workspace_id, user.id);
  if (!membership || membership.status !== "active") throw new AppError("NOT_FOUND", "Experiment was not found.");
  const role = membership.role as WorkspaceRole;
  const canMutate = ACTION_MUTATING_ROLES.includes(role);
  if (mode === "mutate" && !canMutate) throw new AppError("FORBIDDEN", "Viewers can read experiments but cannot change them.");
  return { userId: user.id, experiment, role, canMutate };
}

export type ExperimentMeasurementDependencies = {
  repository: MeasurementRepository;
  /** EXPERIMENT_MEASUREMENT_ENABLED: gates new work only, never draining. */
  measurementEnabled: boolean;
  /** Layer 10 read-only revalidation (plan gate, settled canonical candidate, current proposal); returns the basis guard. */
  revalidateAction(action: ActionRow): Promise<Json | null>;
  now(): Date;
};

const DAY_MS = 86_400_000;

function disabled(): AppError {
  return new AppError("CAPABILITY_DISABLED", "Experiment measurement is not enabled.", 403, { capability: "experiment_measurement" });
}

function invalid(message: string, issues?: unknown): AppError {
  return new AppError("VALIDATION_ERROR", message, 422, issues ? { issues } : undefined);
}

function requireV1(experiment: ExperimentRow): void {
  if (experiment.measurement_policy_version !== EXPERIMENT_MEASUREMENT_POLICY_VERSION) {
    throw new AppError("CONFLICT", "This is a legacy experiment and cannot use measurement v1.", 409, { reason: "legacy_experiment" });
  }
}

function floorUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const iso = (value: string | Date) => new Date(value).toISOString();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The latest non-superseded manual observation for one role and exact period. */
export function currentObservation(rows: ExperimentObservationRow[], role: "baseline" | "measurement", start: string | null, end: string | null): ExperimentObservationRow | null {
  if (!start || !end) return null;
  const superseded = new Set(rows.map((row) => row.supersedes_observation_id).filter(Boolean));
  const candidates = rows.filter((row) => row.source === "manual" && row.window_role === role && iso(row.period_start) === iso(start) && iso(row.period_end) === iso(end) && !superseded.has(row.id));
  return candidates.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0] ?? null;
}

export class ExperimentMeasurementService {
  constructor(private readonly deps: ExperimentMeasurementDependencies) {}

  private assertNewWorkAllowed(): void {
    if (!this.deps.measurementEnabled) throw disabled();
  }

  /** Creates a draft measurement plan for one approved Action (atomic with usage, evidence, audit, transition). */
  async createFromAction(access: ActionAccess, input: unknown): Promise<ExperimentRow> {
    this.assertNewWorkAllowed();
    if (!access.canMutate) throw new AppError("FORBIDDEN", "Viewers can read experiments but cannot change them.");
    const parsed = createMeasurementPlanRequestSchema.safeParse(input);
    if (!parsed.success) throw invalid("The measurement plan is invalid.", parsed.error.issues);
    const { action } = access;
    if (parsed.data.actionId !== action.id) throw new AppError("NOT_FOUND", "Action was not found.");
    if (action.status !== "approved") throw new AppError("CONFLICT", "Experiments can only be created from an approved Action.", 409, { reason: "experiment_action_not_approved" });
    const basisGuard = await this.deps.revalidateAction(action);
    const { design, ...rest } = parsed.data;
    const plan = { ...rest, actionId: undefined };
    const built = buildMeasurementPlan(action, design, plan);
    const payload: Record<string, Json> = {
      ...planColumns(design, plan, built),
      id: randomUUID(),
      evidence_node_id: randomUUID(),
      workspace_id: action.workspace_id,
      product_id: action.product_id,
      action_id: action.id,
      measurement_policy_version: EXPERIMENT_MEASUREMENT_POLICY_VERSION,
      evidence_design: design,
      treatment_proposal_fingerprint: action.proposal_fingerprint,
      idempotency_key: built.idempotencyKey,
    };
    return this.deps.repository.createExperiment(payload, access.userId, basisGuard);
  }

  async updateDraft(access: ExperimentAccess, input: unknown): Promise<ExperimentRow> {
    this.assertNewWorkAllowed();
    const parsed = updateMeasurementDraftRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.experimentId !== access.experiment.id) throw invalid("The measurement plan is invalid.", parsed.success ? undefined : parsed.error.issues);
    const { experiment } = access;
    requireV1(experiment);
    const design = experiment.evidence_design as EvidenceDesign;
    const issues = measurementPlanIssues({ ...parsed.data.plan, design });
    if (issues.length) throw invalid("The measurement plan is invalid.", issues);
    const action = await this.deps.repository.getAction(experiment.workspace_id, experiment.action_id);
    if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
    const built = buildMeasurementPlan(action, design, parsed.data.plan);
    return this.deps.repository.updateDraft(experiment.workspace_id, experiment.id, access.userId, planColumns(design, parsed.data.plan, built));
  }

  async addVariant(access: ExperimentAccess, input: unknown) {
    this.assertNewWorkAllowed();
    const parsed = addMeasurementVariantRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.experimentId !== access.experiment.id) throw invalid("The variant is invalid.", parsed.success ? undefined : parsed.error.issues);
    requireV1(access.experiment);
    return this.deps.repository.addVariant(access.experiment.workspace_id, access.experiment.id, access.userId, {
      id: randomUUID(), evidence_node_id: randomUUID(), variant_key: parsed.data.variantKey, label: parsed.data.label,
      content: parsed.data.content as Json, allocation_weight: parsed.data.allocationWeight, is_control: parsed.data.isControl,
      source_action_variant_id: parsed.data.sourceActionVariantId ?? null,
    });
  }

  /** Registers the plan (freezes it and the before/after baseline window). */
  async markReady(access: ExperimentAccess): Promise<ExperimentRow> {
    this.assertNewWorkAllowed();
    requireV1(access.experiment);
    return this.deps.repository.markReady(access.experiment.workspace_id, access.experiment.id, access.userId);
  }

  /** Never flag-gated: stopping is always allowed (before treatment → canceled_before_treatment, after → stopped_early). */
  async cancel(access: ExperimentAccess, input: unknown): Promise<ExperimentRow> {
    const parsed = cancelExperimentRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.experimentId !== access.experiment.id) throw invalid("The request is invalid.");
    requireV1(access.experiment);
    return this.deps.repository.cancel(access.experiment.workspace_id, access.experiment.id, access.userId, parsed.data.note ?? null);
  }

  /**
   * A manual value for the frozen window. Baseline entry is setup (flag-gated);
   * a measurement value for a running experiment is draining (never gated).
   */
  async recordManualObservation(access: ExperimentAccess, input: unknown): Promise<ExperimentObservationRow> {
    const parsed = recordManualObservationRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.experimentId !== access.experiment.id) throw invalid("The value is invalid.", parsed.success ? undefined : parsed.error.issues);
    const { experiment } = access;
    requireV1(experiment);
    if (experiment.evidence_design !== "before_after") throw invalid("Controlled splits are measured from events, not manual values.");
    let periodStart: string;
    let periodEnd: string;
    if (parsed.data.windowRole === "baseline") {
      this.assertNewWorkAllowed();
      const end = floorUtcDay(this.deps.now());
      periodEnd = end.toISOString();
      periodStart = new Date(end.getTime() - MEASUREMENT_WINDOW_DAYS[experiment.measurement_window as MeasurementWindow] * DAY_MS).toISOString();
    } else {
      if (!experiment.measurement_start || !experiment.measurement_end) throw new AppError("CONFLICT", "The measurement window has not started.", 409, { reason: "observation_window_invalid" });
      periodStart = experiment.measurement_start;
      periodEnd = experiment.measurement_end;
    }
    const idempotencyKey = parsed.data.idempotencyKey
      ?? `manual:${parsed.data.windowRole}:${sha256Json({ periodStart: iso(periodStart), value: parsed.data.value, denominator: parsed.data.denominator ?? null, supersedes: parsed.data.supersedesObservationId ?? null }).slice(0, 32)}`;
    return this.deps.repository.recordObservation({
      id: randomUUID(), evidence_node_id: randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id,
      metric_key: experiment.primary_metric, window_role: parsed.data.windowRole, period_start: periodStart, period_end: periodEnd,
      value: parsed.data.value, denominator: parsed.data.denominator ?? null, source: "manual", note: parsed.data.note ?? null,
      supersedes_observation_id: parsed.data.supersedesObservationId ?? null, idempotency_key: idempotencyKey,
    }, "user", access.userId);
  }

  /** Public event token for a controlled split. Issuing for a running split is draining; before start it is setup. */
  async issueToken(access: ExperimentAccess) {
    requireV1(access.experiment);
    if (access.experiment.status !== "running") this.assertNewWorkAllowed();
    const raw = `wexp_${randomBytes(24).toString("base64url")}`;
    const publicKey = `wexp_pub_${randomBytes(12).toString("base64url")}`;
    const record = await this.deps.repository.issueToken(access.experiment.workspace_id, access.experiment.id, access.userId, randomUUID(), publicKey, hashToken(raw));
    return { token: raw, record };
  }

  /** Workspace scope is inside the RPC's UPDATE; a foreign token id is never touched. */
  async revokeToken(access: ExperimentAccess, input: unknown) {
    const parsed = revokeExperimentTokenRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.experimentId !== access.experiment.id) throw invalid("The request is invalid.");
    return this.deps.repository.revokeToken(access.experiment.workspace_id, parsed.data.tokenId, access.userId);
  }

  // ------------------------------------------------------------------ measurement pass

  /**
   * Single automatic writer. Bounded (≤ 50), idempotent (results keyed by input
   * fingerprint), no provider or LLM calls, and it runs regardless of the flag
   * so a rollback can never leave running experiments undrained.
   */
  async runMeasurementPass(limit = EXPERIMENT_MEASUREMENT_PASS_LIMIT): Promise<{ due: number; finalized: number; failed: number; outcomes: Record<string, number> }> {
    const now = this.deps.now();
    const due = await this.deps.repository.dueForMeasurement(now, Math.min(limit, EXPERIMENT_MEASUREMENT_PASS_LIMIT));
    let finalized = 0;
    let failed = 0;
    const outcomes: Record<string, number> = {};
    for (const experiment of due) {
      try {
        const result = await this.measureOne(experiment, now);
        finalized += 1;
        outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      } catch {
        // One experiment never blocks the rest; it stays due and is retried next pass.
        failed += 1;
      }
    }
    return { due: due.length, finalized, failed, outcomes };
  }

  async measureOne(experiment: ExperimentRow, now: Date): Promise<OutcomeResult> {
    requireV1(experiment);
    const repository = this.deps.repository;
    const action = await repository.getAction(experiment.workspace_id, experiment.action_id);
    if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
    const design = experiment.evidence_design as EvidenceDesign;
    const windowDays = MEASUREMENT_WINDOW_DAYS[experiment.measurement_window as MeasurementWindow];
    const closing = experiment.status === "running";

    // One context snapshot (market evidence count), never an outcome input.
    if (closing && experiment.measurement_start && experiment.measurement_end) {
      const context = await repository.marketContext(action);
      if (context) {
        await repository.recordObservation({
          id: randomUUID(), evidence_node_id: randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id,
          metric_key: CONTEXT_METRIC_KEY, window_role: "measurement", period_start: experiment.measurement_start, period_end: experiment.measurement_end,
          value: context.value, source: "wanterest_internal", source_ref: { evidenceNodeId: context.evidenceNodeId },
          idempotency_key: `context:${experiment.id}:measurement`,
        }, "system", null);
      }
    }

    let baseline: ObservedValue | null = null;
    let measurement: ObservedValue | null = null;
    let arms: ArmCount[] = [];
    let daysWithExposure = 0;
    if (design === "before_after") {
      const rows = await repository.listObservations(experiment.workspace_id, experiment.id);
      const b = currentObservation(rows, "baseline", experiment.baseline_start, experiment.baseline_end);
      const m = currentObservation(rows, "measurement", experiment.measurement_start, experiment.measurement_end);
      baseline = b ? { id: b.id, value: Number(b.value), denominator: b.denominator === null ? null : Number(b.denominator) } : null;
      measurement = m ? { id: m.id, value: Number(m.value), denominator: m.denominator === null ? null : Number(m.denominator) } : null;
    } else if (experiment.treatment_started_at) {
      const counts = await repository.armCounts(experiment.workspace_id, experiment.id);
      arms = counts.map((row) => ({ variantId: row.variant_id, isControl: row.is_control, exposed: Number(row.exposed), converted: Number(row.converted), excludedEvents: Number(row.excluded_events) }));
      daysWithExposure = Number(counts[0]?.days_with_exposure ?? 0);
    }
    const graceExpired = experiment.measurement_end ? now.getTime() >= new Date(experiment.measurement_end).getTime() + MANUAL_MEASUREMENT_GRACE_DAYS * DAY_MS : false;
    const outcome = computeExperimentOutcome({
      experimentId: experiment.id,
      planFingerprint: String(experiment.measurement_plan_fingerprint),
      design,
      primaryMetric: experiment.primary_metric,
      metricLabel: experiment.metric_label,
      metricUnit: experiment.metric_unit as MetricUnit | null,
      successCriterion: experiment.success_criterion as unknown as SuccessCriterion,
      status: experiment.status as "running" | "completed" | "canceled",
      closedReason: experiment.closed_reason,
      treatment: {
        actionStatus: action.status,
        liveSince: action.status === "completed" ? await repository.actionLiveSince(experiment.workspace_id, action.id) : null,
        measurementStart: String(experiment.measurement_start ?? experiment.treatment_started_at ?? now.toISOString()),
        measurementEnd: String(experiment.measurement_end ?? now.toISOString()),
      },
      graceExpired,
      baseline,
      measurement,
      arms,
      windowDays,
      daysWithExposure,
    });
    await repository.finalize(experiment.workspace_id, experiment.id, {
      id: randomUUID(), evidence_node_id: randomUUID(), outcome: outcome.outcome, attribution_class: outcome.attributionClass,
      treatment_integrity: outcome.treatmentIntegrity, baseline_value: outcome.baselineValue, observed_value: outcome.observedValue,
      effect: outcome.effect, effect_basis: outcome.effectBasis, evidence_completeness: outcome.evidenceCompleteness,
      inconclusive_reasons: outcome.inconclusiveReasons, invalidation_reason: outcome.invalidationReason, input_fingerprint: outcome.inputFingerprint,
      arm_results: outcome.armResults as unknown as Json, summary: outcome.summary, min_sample_size: experiment.min_sample_size,
      total_assignments: arms.reduce((sum, arm) => sum + arm.exposed, 0), total_exposed_subjects: arms.reduce((sum, arm) => sum + arm.exposed, 0),
      variant_results: (outcome.armResults ?? []) as unknown as Json,
    }, closing, outcome.observationIds);
    return outcome;
  }
}

/** Controlled splits are due one day after the window (event lag); exported for tests and the due query contract. */
export const CONTROLLED_DUE_AFTER_MS = CONTROLLED_FINALIZE_LAG_DAYS * DAY_MS;
