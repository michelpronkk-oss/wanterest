import { createHash, randomBytes } from "node:crypto";

import type { ActionRepository } from "../actions/action.repository";
import type { ActionType } from "../../db/database.helpers";
import type { Json } from "../../db/database.types";
import { AppError } from "../../lib/errors";
import type { ConsumeUsageInput } from "../entitlements/entitlement.schemas";
import {
  assignmentSchema, createExperimentSchema, createExperimentVariantSchema, experimentTransitionSchema,
  publicExperimentEventSchema, type AssignmentInput, type CreateExperimentInput, type CreateExperimentVariantInput,
  type ExperimentTransitionInput, type PublicExperimentEventInput,
} from "./experiment.schemas";
import { hashExperimentSubject, type ExperimentRepository } from "./experiment.repository";
import type { ExperimentRow, ExperimentVariantRow, ExperimentResultRow } from "../../db/database.helpers";

const EXPERIMENT_CALCULATION_VERSION = "experiment_results_v1";
const WEIGHT_TOTAL = 10_000;
const allowedTransitions: Record<ExperimentRow["status"], ExperimentRow["status"][]> = {
  draft: ["ready", "canceled"], ready: ["running", "canceled"], running: ["paused", "completed", "canceled"],
  paused: ["running", "completed", "canceled"], completed: [], canceled: [],
};

export type ExperimentEntitlements = {
  can(workspaceId: string, capability: string): Promise<boolean>;
  limit(workspaceId: string, entitlement: string): Promise<number | string | boolean | null>;
  consume(workspaceId: string, input: Pick<ConsumeUsageInput, "usageType" | "amount" | "idempotencyKey" | "sourceMetadata">): Promise<unknown>;
};

const permissiveEntitlements: ExperimentEntitlements = {
  can: async () => true,
  limit: async () => 1_000_000,
  consume: async () => undefined,
};

export type ExperimentServiceOptions = {
  repository: ExperimentRepository;
  actions: Pick<ActionRepository, "getAction">;
  entitlements?: ExperimentEntitlements;
  audit?: (input: { workspaceId: string; actorUserId?: string; action: string; targetId: string; metadata?: Record<string, Json> }) => Promise<void>;
};

export type InternalExperimentEventInput = {
  workspaceId: string; experimentId: string; assignmentId: string; variantId: string; eventId: string;
  eventType: "exposure" | "cta_click" | "signup_started" | "signup_completed" | "demo_requested" | "checkout_started" | "purchase_completed";
  occurredAt?: string; metadata?: Record<string, Json>;
};

export class ExperimentService {
  private readonly entitlements: ExperimentEntitlements;
  constructor(private readonly options: ExperimentServiceOptions) { this.entitlements = options.entitlements ?? permissiveEntitlements; }

  async createExperiment(input: CreateExperimentInput | unknown): Promise<ExperimentRow> {
    const parsed = createExperimentSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid experiment.", 422, { issues: parsed.error.issues });
    const action = await this.options.actions.getAction(parsed.data.workspaceId, parsed.data.actionId);
    if (!action || action.product_id !== parsed.data.productId) throw new AppError("FORBIDDEN", "The experiment Action is not in this workspace/product.");
    if (action.status !== "approved") throw new AppError("CONFLICT", "Experiments require an approved Action.");
    if (!actionTypeSupportsExperiment(action.action_type as ActionType, parsed.data.experimentType)) throw new AppError("VALIDATION_ERROR", "The experiment type is not compatible with the Action type.");
    if (!(await this.entitlements.can(parsed.data.workspaceId, "actions_enabled"))) throw new AppError("CAPABILITY_DISABLED", "Actions and experiments are not enabled for this workspace.", 403, {
      entitlementCode: "EXPERIMENTS_NOT_INCLUDED",
      capability: "actions_enabled",
      current: 0,
      limit: 0,
      upgradeTarget: "pro",
    });
    const max = await this.entitlements.limit(parsed.data.workspaceId, "experiments_max");
    const current = (await this.options.repository.listExperiments(parsed.data.workspaceId)).filter((row) => !["completed", "canceled"].includes(row.status)).length;
    if (typeof max === "number" && current >= max) throw new AppError("USAGE_LIMIT_EXCEEDED", "The workspace experiment limit was reached.", 429, {
      entitlementCode: "EXPERIMENT_LIMIT_REACHED",
      capability: "experiments_max",
      current,
      limit: max,
      upgradeTarget: max === 0 ? "pro" : max < 10 ? "growth" : null,
    });
    const id = crypto.randomUUID();
    const evidenceNodeId = crypto.randomUUID();
    const row = await this.options.repository.createExperiment({
      id, workspace_id: parsed.data.workspaceId, product_id: parsed.data.productId, action_id: parsed.data.actionId,
      evidence_node_id: evidenceNodeId, experiment_type: parsed.data.experimentType, name: parsed.data.name,
      hypothesis: parsed.data.hypothesis, primary_metric: parsed.data.primaryMetric, status: "draft",
      traffic_allocation: {}, target_page_path: parsed.data.targetPagePath ?? null, target_key: parsed.data.targetKey ?? null,
      assignment_method: "deterministic_hash_v1", min_sample_size: parsed.data.minSampleSize, created_by: parsed.data.createdBy,
      engine_version_id: parsed.data.engineVersionId ?? null, current_result_id: null, started_at: null, ended_at: null,
    });
    try {
      await this.entitlements.consume(parsed.data.workspaceId, { usageType: "experiment_created", amount: 1, idempotencyKey: `experiment_created:${row.id}`, sourceMetadata: { experimentId: row.id, actionId: row.action_id } });
    } catch (error) {
      // The Phase 7 usage ledger is the authority. Until the database-side
      // create-and-consume RPC exists, compensate the just-created draft so a
      // failed entitlement write cannot leave a phantom active experiment.
      await this.options.repository.deleteExperiment(parsed.data.workspaceId, row.id).catch(() => undefined);
      throw error;
    }
    await this.options.repository.linkProvenance({ derivedEvidenceNodeId: evidenceNodeId, sourceEvidenceNodeId: action.evidence_node_id, relationType: "derived_from_action", ordinal: 0 });
    await this.audit(parsed.data.workspaceId, parsed.data.createdBy, "experiment.created", row.id, { actionId: row.action_id });
    return row;
  }

  async createVariant(input: CreateExperimentVariantInput | unknown): Promise<ExperimentVariantRow> {
    const parsed = createExperimentVariantSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid experiment variant.", 422, { issues: parsed.error.issues });
    const experiment = await this.requireExperiment(parsed.data.workspaceId, parsed.data.experimentId);
    if (experiment.status !== "draft") throw new AppError("CONFLICT", "Variants can only be added while an experiment is a draft.");
    const variant = await this.options.repository.createVariant({
      id: crypto.randomUUID(), workspace_id: parsed.data.workspaceId, experiment_id: parsed.data.experimentId, evidence_node_id: crypto.randomUUID(),
      source_action_variant_id: parsed.data.sourceActionVariantId ?? null, variant_key: parsed.data.variantKey,
      label: parsed.data.label, content: parsed.data.content, target: parsed.data.target,
      allocation_weight: parsed.data.allocationWeight, is_control: parsed.data.isControl,
    });
    await this.options.repository.linkProvenance({ derivedEvidenceNodeId: variant.evidence_node_id, sourceEvidenceNodeId: experiment.evidence_node_id, relationType: "variant_of_experiment" });
    return variant;
  }

  async transition(input: ExperimentTransitionInput | unknown): Promise<ExperimentRow> {
    const parsed = experimentTransitionSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid experiment transition.", 422, { issues: parsed.error.issues });
    const experiment = await this.requireExperiment(parsed.data.workspaceId, parsed.data.experimentId);
    if (!allowedTransitions[experiment.status].includes(parsed.data.toStatus)) throw new AppError("CONFLICT", `Experiment cannot transition from ${experiment.status} to ${parsed.data.toStatus}.`);
    if (parsed.data.toStatus === "ready") await this.assertReady(experiment);
    const timestamp = new Date().toISOString();
    const patch = { status: parsed.data.toStatus, started_at: parsed.data.toStatus === "running" && !experiment.started_at ? timestamp : experiment.started_at, ended_at: ["completed", "canceled"].includes(parsed.data.toStatus) ? timestamp : experiment.ended_at } as const;
    const updated = await this.options.repository.updateExperiment(parsed.data.workspaceId, parsed.data.experimentId, patch);
    await this.audit(parsed.data.workspaceId, parsed.data.actorUserId, `experiment.${parsed.data.toStatus}`, experiment.id);
    return updated;
  }

  async assignVariant(input: AssignmentInput | unknown) {
    const parsed = assignmentSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid experiment assignment.", 422, { issues: parsed.error.issues });
    const experiment = await this.requireActive(parsed.data.workspaceId, parsed.data.experimentId);
    const variants = await this.options.repository.listVariants(parsed.data.workspaceId, experiment.id);
    this.assertWeights(variants);
    const subjectHash = hashExperimentSubject(experiment.id, parsed.data.subjectKey);
    const existing = await this.options.repository.getAssignment(experiment.workspace_id, experiment.id, subjectHash);
    if (existing) return { assignment: existing, variant: variants.find((variant) => variant.id === existing.variant_id) ?? null };
    const bucket = Number.parseInt(createHash("sha256").update(`${experiment.id}:${parsed.data.subjectKey}`).digest("hex").slice(0, 8), 16) % WEIGHT_TOTAL;
    let cursor = 0;
    const selected = variants.find((variant) => { cursor += variant.allocation_weight; return bucket < cursor; });
    if (!selected) throw new AppError("INTERNAL_ERROR", "Experiment allocation could not select a variant.");
    const assignment = await this.options.repository.createAssignment({ id: crypto.randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id, variant_id: selected.id, subject_key_hash: subjectHash, assignment_method: "deterministic_hash_v1", assigned_at: new Date().toISOString() });
    return { assignment, variant: selected };
  }

  async recordExposure(input: PublicExperimentEventInput | unknown) { return this.recordPublicEvent(input, "exposure"); }
  async recordOutcome(input: PublicExperimentEventInput | unknown) {
    const parsed = publicExperimentEventSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid experiment outcome.", 422, { issues: parsed.error.issues });
    if (parsed.data.eventType === "exposure") throw new AppError("VALIDATION_ERROR", "Outcome events cannot be exposure events.");
    return this.recordPublicEvent(parsed.data, parsed.data.eventType);
  }

  async recordExposureForAssignment(input: InternalExperimentEventInput) { return this.recordInternalAssignmentEvent(input, "exposure"); }
  async recordOutcomeForAssignment(input: InternalExperimentEventInput) { if (input.eventType === "exposure") throw new AppError("VALIDATION_ERROR", "Outcome events cannot be exposure events."); return this.recordInternalAssignmentEvent(input, input.eventType); }

  async recordPublicEvent(input: PublicExperimentEventInput | unknown, expectedType?: "exposure" | string) {
    const parsed = publicExperimentEventSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid experiment event.", 422, { issues: parsed.error.issues });
    if (expectedType && parsed.data.eventType !== expectedType) throw new AppError("VALIDATION_ERROR", "The event type does not match the endpoint.");
    const tokenHash = hashToken(parsed.data.publicToken);
    const token = await this.options.repository.findTokenByHash(tokenHash);
    if (!token || token.status !== "active") throw new AppError("FORBIDDEN", "The experiment token is invalid or revoked.");
    if (token.experiment_id !== parsed.data.experimentId) throw new AppError("FORBIDDEN", "The experiment token is not scoped to this experiment.");
    const experiment = await this.requireActive(token.workspace_id, token.experiment_id);
    const subjectHash = hashExperimentSubject(experiment.id, parsed.data.subjectKey);
    const assignment = await this.options.repository.getAssignment(experiment.workspace_id, experiment.id, subjectHash);
    if (!assignment || assignment.variant_id !== parsed.data.variantId) throw new AppError("CONFLICT", "The event does not match the deterministic assignment.");
    const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
    if (Math.abs(Date.now() - occurredAt.getTime()) > 24 * 60 * 60 * 1000) throw new AppError("VALIDATION_ERROR", "The event timestamp is outside the accepted window.");
    const event = await this.options.repository.recordEvent({ id: crypto.randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id, variant_id: assignment.variant_id, assignment_id: assignment.id, external_event_id: parsed.data.eventId, event_type: parsed.data.eventType, subject_key_hash: subjectHash, occurred_at: occurredAt.toISOString(), received_at: new Date().toISOString(), metadata: parsed.data.metadata });
    await this.options.repository.updateToken(token.id, { last_used_at: new Date().toISOString() });
    return event;
  }

  async issuePublicToken(workspaceId: string, experimentId: string) {
    await this.requireExperiment(workspaceId, experimentId);
    const raw = `wexp_${randomBytes(24).toString("base64url")}`;
    const publicKey = `wexp_pub_${randomBytes(12).toString("base64url")}`;
    const token = await this.options.repository.issueToken({ id: crypto.randomUUID(), workspace_id: workspaceId, experiment_id: experimentId, public_key: publicKey, token_hash: hashToken(raw), status: "active", created_at: new Date().toISOString(), revoked_at: null, last_used_at: null });
    return { token: raw, record: token };
  }

  async revokePublicToken(workspaceId: string, tokenId: string) {
    const updated = await this.options.repository.updateToken(tokenId, { status: "revoked", revoked_at: new Date().toISOString() });
    if (updated.workspace_id !== workspaceId) throw new AppError("FORBIDDEN", "The token is not in this workspace.");
    return updated;
  }

  async getActivePublicExperiment(publicToken: string) {
    const token = await this.options.repository.findTokenByHash(hashToken(publicToken));
    if (!token) throw new AppError("NOT_FOUND", "No active experiment was found for this token.");
    const experiment = await this.requireActive(token.workspace_id, token.experiment_id);
    const variants = await this.options.repository.listVariants(token.workspace_id, token.experiment_id);
    return { id: experiment.id, productId: experiment.product_id, type: experiment.experiment_type, primaryMetric: experiment.primary_metric, targetPagePath: experiment.target_page_path, targetKey: experiment.target_key, assignmentMethod: experiment.assignment_method, variants: variants.map((variant) => ({ id: variant.id, key: variant.variant_key, label: variant.label, content: variant.content, target: variant.target })) };
  }

  async getActiveExperiments(workspaceId: string, productId?: string) {
    const rows = (await this.options.repository.listExperiments(workspaceId, productId)).filter((row) => row.status === "running");
    return Promise.all(rows.map(async (experiment) => ({ experiment, variants: await this.options.repository.listVariants(workspaceId, experiment.id) })));
  }

  async calculateResults(workspaceId: string, experimentId: string): Promise<ExperimentResultRow> {
    const experiment = await this.requireExperiment(workspaceId, experimentId);
    const variants = await this.options.repository.listVariants(workspaceId, experimentId);
    const assignments = await this.options.repository.listAssignments(workspaceId, experimentId);
    const allAssignments = new Set(assignments.map((assignment) => assignment.id));
    const events = await this.options.repository.listEvents(workspaceId, experimentId);
    const exposureSubjects = new Set(events.filter((event) => event.event_type === "exposure").map((event) => event.subject_key_hash));
    const control = variants.find((variant) => variant.is_control);
    const resultRows = variants.map((variant) => {
      const variantAssignments = new Set(events.filter((event) => event.variant_id === variant.id && event.event_type === "exposure").map((event) => event.subject_key_hash));
      const converting = new Set(events.filter((event) => event.variant_id === variant.id && event.event_type === experiment.primary_metric).map((event) => event.subject_key_hash));
      const conversionRate = variantAssignments.size ? converting.size / variantAssignments.size : 0;
      const controlRate = control ? (() => { const c = new Set(events.filter((event) => event.variant_id === control.id && event.event_type === "exposure").map((event) => event.subject_key_hash)); const x = new Set(events.filter((event) => event.variant_id === control.id && event.event_type === experiment.primary_metric).map((event) => event.subject_key_hash)); return c.size ? x.size / c.size : 0; })() : null;
      return { variantId: variant.id, variantKey: variant.variant_key, isControl: variant.is_control, assignmentCount: new Set(events.filter((event) => event.variant_id === variant.id).map((event) => event.assignment_id)).size, uniqueExposedSubjects: variantAssignments.size, uniqueConvertingSubjects: converting.size, conversionRate, sampleCount: variantAssignments.size, absoluteDeltaFromControl: controlRate === null ? null : conversionRate - controlRate };
    });
    const state = experiment.status === "completed" ? "completed" : exposureSubjects.size < experiment.min_sample_size ? "insufficient_data" : resultRows.some((row) => row.uniqueConvertingSubjects > 0) ? "directional" : "collecting";
    const previous = await this.options.repository.latestResult(workspaceId, experimentId);
    const row = await this.options.repository.createResult({ id: crypto.randomUUID(), workspace_id: workspaceId, experiment_id: experimentId, evidence_node_id: crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, calculation_version: EXPERIMENT_CALCULATION_VERSION, primary_metric: experiment.primary_metric, result_state: state, min_sample_size: experiment.min_sample_size, total_assignments: allAssignments.size, total_exposed_subjects: exposureSubjects.size, variant_results: resultRows as unknown as Json, calculated_at: new Date().toISOString(), created_at: new Date().toISOString() });
    await this.options.repository.updateExperiment(workspaceId, experimentId, { current_result_id: row.id });
    await this.options.repository.linkProvenance({ derivedEvidenceNodeId: row.evidence_node_id, sourceEvidenceNodeId: experiment.evidence_node_id, relationType: "measures_experiment" });
    return row;
  }

  async recomputeResults(workspaceId: string, experimentId: string) { return this.calculateResults(workspaceId, experimentId); }

  private async recordInternalEvent(input: { workspaceId: string; experimentId: string; eventId: string; eventType: "exposure" | "cta_click" | "signup_started" | "signup_completed" | "demo_requested" | "checkout_started" | "purchase_completed"; subjectKey: string; variantId: string; metadata?: Record<string, Json> }) {
    return this.recordPublicEvent({ publicToken: "x".repeat(20), experimentId: input.experimentId, eventId: input.eventId, eventType: input.eventType, subjectKey: input.subjectKey, variantId: input.variantId, metadata: input.metadata ?? {} });
  }

  private async recordInternalAssignmentEvent(input: InternalExperimentEventInput, expectedType: string) {
    if (input.eventType !== expectedType) throw new AppError("VALIDATION_ERROR", "The event type does not match the endpoint.");
    const experiment = await this.requireActive(input.workspaceId, input.experimentId);
    const assignment = await this.options.repository.getAssignmentById(input.workspaceId, input.experimentId, input.assignmentId);
    if (!assignment || assignment.variant_id !== input.variantId) throw new AppError("CONFLICT", "The event does not match the assignment.");
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Math.abs(Date.now() - occurredAt.getTime()) > 24 * 60 * 60 * 1000) throw new AppError("VALIDATION_ERROR", "The event timestamp is outside the accepted window.");
    return this.options.repository.recordEvent({ id: crypto.randomUUID(), workspace_id: experiment.workspace_id, experiment_id: experiment.id, variant_id: assignment.variant_id, assignment_id: assignment.id, external_event_id: input.eventId, event_type: input.eventType, subject_key_hash: assignment.subject_key_hash, occurred_at: occurredAt.toISOString(), received_at: new Date().toISOString(), metadata: input.metadata ?? {} });
  }

  private async requireExperiment(workspaceId: string, experimentId: string) { const experiment = await this.options.repository.getExperiment(workspaceId, experimentId); if (!experiment) throw new AppError("NOT_FOUND", "Experiment was not found."); return experiment; }
  private async requireActive(workspaceId: string, experimentId: string) { const experiment = await this.requireExperiment(workspaceId, experimentId); if (!["running", "paused"].includes(experiment.status)) throw new AppError("CONFLICT", "The experiment is not accepting assignments or events."); return experiment; }
  private async assertReady(experiment: ExperimentRow) { const variants = await this.options.repository.listVariants(experiment.workspace_id, experiment.id); this.assertWeights(variants); if (variants.filter((variant) => variant.is_control).length !== 1) throw new AppError("VALIDATION_ERROR", "An experiment requires exactly one control variant."); if (!experiment.target_page_path || !experiment.target_key) throw new AppError("VALIDATION_ERROR", "An experiment target page path and target key are required."); }
  private assertWeights(variants: ExperimentVariantRow[]) { if (variants.length < 2 || variants.reduce((sum, variant) => sum + variant.allocation_weight, 0) !== WEIGHT_TOTAL) throw new AppError("VALIDATION_ERROR", "Experiment variant weights must total 10000 and include at least two variants."); }
  private async audit(workspaceId: string, actorUserId: string | undefined, action: string, targetId: string, metadata?: Record<string, Json>) { if (this.options.audit) await this.options.audit({ workspaceId, actorUserId, action, targetId, metadata }); }
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function actionTypeSupportsExperiment(actionType: ActionType, experimentType: CreateExperimentInput["experimentType"]): boolean {
  const map: Partial<Record<ActionType, CreateExperimentInput["experimentType"][]>> = {
    messaging_change: ["messaging_test"], content_angle: ["messaging_test"], campaign_angle: ["messaging_test"],
    landing_page: ["landing_page_test", "cta_test"], comparison_page: ["landing_page_test", "positioning_test"],
    positioning_change: ["positioning_test"], offer_hypothesis: ["offer_test"], onboarding_change: ["onboarding_test"],
  };
  return map[actionType]?.includes(experimentType) ?? false;
}

export { hashToken };
