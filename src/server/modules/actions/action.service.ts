import { AppError } from "../../lib/errors";
import { deterministicUuid, sha256Json } from "../ingestion/hash";
import { jsonValueSchema, type Json, type JsonObject } from "../../db/database.helpers";
import type { ActionEventRow, ActionFeedbackRow, ActionRow, ActionVariantRow } from "../../db/database.helpers";
import { isConceptTriggerType, actionBasisLifecycleStatus, actionFeedbackInputSchema, actionFeedbackTypeSchema, actionGenerationInputSchema, actionListFiltersSchema, actionStatusSchema, actionTypeSchema, businessHypothesisSchema, parseVariantContent, type ActionBasisLifecycleStatus, type ActionFeedbackType, type ActionGenerationInput, type ActionListFilters, type ActionStatus } from "./action.schemas";
import { ACTION_PRIORITY_FORMULA_VERSION, FixtureDemandActionEngine, FixtureDemandActionVariantEngine, type DemandActionEngine, type DemandActionVariantEngine } from "./action.engines";
import type { ActionBasisGuardPayload, ActionClient, ActionRepository } from "./action.repository";
import type { ActionLiveBasis } from "./concept-action.selector";

export type ActionEntitlementPort = { can(workspaceId: string, capability: "actions_enabled"): Promise<boolean> };
export type ActionAuditPort = { record(input: { workspaceId: string; actorUserId: string; action: string; targetId: string; metadata?: Record<string, unknown> }): Promise<void> };

export function createSupabaseActionAuditPort(client: ActionClient): ActionAuditPort {
  return {
    async record(input) {
      const { error } = await client.rpc("record_audit_event", {
        p_workspace_id: input.workspaceId,
        p_actor_user_id: input.actorUserId,
        p_actor_kind: "user",
        p_action: input.action,
        p_target_type: "action",
        p_target_id: input.targetId,
        p_metadata: jsonValueSchema.parse(input.metadata ?? {}),
      });
      if (error) throw new AppError("INTERNAL_ERROR", "Action audit event could not be recorded.");
    },
  };
}

export type ActionReadModel = {
  action: ActionRow;
  variants: ActionVariantRow[];
  feedback: ActionFeedbackRow[];
  events: ActionEventRow[];
  evidenceContext: Json;
  feedbackState: { latest: ActionFeedbackType | null; useful: boolean | null; saved: boolean | null; dismissed: boolean | null };
  provenance: { actionEvidenceNodeId: string; triggerEvidenceNodeId: string; supportingEvidenceNodeIds: string[] };
  /** Layer 9B, read-only (see action.schemas.ts). Never rewrites the stored Action. */
  basisLifecycleStatus: ActionBasisLifecycleStatus;
  /** Layer 10, derived and read-only: live basis safety + allowed human transitions (null until evaluated). */
  liveBasis: ActionLiveBasis | null;
};

export type ActionGenerationOutput = { actions: ActionRow[]; suppressed: string[] };

// Layer 10 lifecycle (docs/architecture.md Section 21). `expired` is system-only
// and `superseded` of a concept Action only happens atomically inside
// create_concept_action; in_progress is never auto-expired or auto-superseded.
const transitions: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ["approved", "dismissed", "superseded", "expired"],
  approved: ["in_progress", "dismissed", "superseded", "expired"],
  in_progress: ["completed", "dismissed"],
  completed: [],
  dismissed: [],
  superseded: [],
  expired: [],
};

function json(value: unknown): Json { return jsonValueSchema.parse(value); }
function now(): string { return new Date().toISOString(); }
function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

export class DemandActionService {
  constructor(
    private readonly repository: ActionRepository,
    private readonly entitlements?: ActionEntitlementPort,
    private readonly audit?: ActionAuditPort,
    private readonly options?: { downstreamIntelligenceV2Enabled?: boolean },
  ) {}

  async generateActions(input: ActionGenerationInput, engine: DemandActionEngine = new FixtureDemandActionEngine()): Promise<ActionGenerationOutput> {
    const parsed = actionGenerationInputSchema.parse(input);
    // Layer 10: concept Actions are written only by ConceptActionService through the atomic RPC.
    if (isConceptTriggerType(parsed.triggerType)) throw new AppError("VALIDATION_ERROR", "Concept Actions are generated only by the concept Action pass.");
    if (this.entitlements && !(await this.entitlements.can(parsed.workspaceId, "actions_enabled"))) {
      return { actions: [], suppressed: ["actions_enabled"] };
    }
    const results = await engine.generate(parsed);
    const actions: ActionRow[] = [];
    const suppressed: string[] = [];
    for (const result of results) {
      const idempotencyKey = `action:${parsed.productId}:${parsed.triggerType}:${parsed.triggerId}:${engine.version}`;
      const existing = await this.repository.findActionByIdempotency(parsed.workspaceId, idempotencyKey);
      if (existing) {
        if (existing.status === "dismissed" || existing.status === "superseded") suppressed.push(existing.status);
        else actions.push(existing);
        continue;
      }
      const actionId = deterministicUuid(`${idempotencyKey}:${result.inputFingerprint}`);
      const created = await this.repository.createAction({
        id: actionId,
        workspace_id: parsed.workspaceId,
        product_id: parsed.productId,
        evidence_node_id: deterministicUuid(`evidence:action:${actionId}`),
        action_type: result.actionType,
        trigger_type: parsed.triggerType,
        trigger_id: parsed.triggerId,
        trigger_evidence_node_id: parsed.triggerEvidenceNodeId,
        trigger_concept_key: parsed.triggerConceptKey,
        target_key: result.targetKey,
        title: result.title,
        summary: result.summary,
        why: result.why,
        suggested_change: result.suggestedChange,
        current_state: result.currentState,
        target_metric: result.targetMetric,
        business_hypothesis: json(result.businessHypothesis),
        evidence_context: json({ buyerLanguage: parsed.buyerLanguage, supportingEvidenceNodeIds: parsed.supportingEvidence, geoContext: parsed.geoContext ?? null, measurements: { marketWeight: parsed.marketWeight, gapScore: parsed.gapScore, driftStrength: parsed.driftStrength, opportunityScore: parsed.opportunityScore, sampleSize: parsed.sampleSize, sampleQuality: parsed.sampleQuality } }),
        priority_score: clamp(result.priorityScore),
        confidence: clamp(result.confidence),
        status: "proposed",
        action_engine_version_id: parsed.actionEngineVersionId ?? deterministicUuid(`engine:action:${engine.version}`),
        priority_formula_version: ACTION_PRIORITY_FORMULA_VERSION,
        input_fingerprint: result.inputFingerprint,
        idempotency_key: idempotencyKey,
        approved_at: null,
        completed_at: null,
        dismissed_at: null,
        valid_from: now(),
        stale_at: null,
        superseded_by_action_id: null,
        updated_at: now(),
      });
      const wasCreated = created.id === actionId;
      if (wasCreated) {
        try {
          await this.repository.consumeUsage({ workspaceId: parsed.workspaceId, idempotencyKey: `action_generated:${created.id}`, sourceMetadata: { actionId: created.id, triggerType: parsed.triggerType, triggerId: parsed.triggerId } });
        } catch (error) {
          if (error instanceof AppError && (error.code === "CAPABILITY_DISABLED" || error.code === "USAGE_LIMIT_EXCEEDED")) {
            await this.transitionAction({ workspaceId: parsed.workspaceId, actionId: created.id, toStatus: "dismissed", actorKind: "system" });
            suppressed.push(error.code);
            continue;
          }
          throw error;
        }
      }
      await this.repository.linkProvenance({ derivedEvidenceNodeId: created.evidence_node_id, sourceEvidenceNodeId: parsed.triggerEvidenceNodeId, relationType: "triggered_by", weight: parsed.evidenceStrength, ordinal: 0, engineVersionId: created.action_engine_version_id });
      for (const [ordinal, evidenceNodeId] of parsed.supportingEvidence.entries()) {
        await this.repository.linkProvenance({ derivedEvidenceNodeId: created.evidence_node_id, sourceEvidenceNodeId: evidenceNodeId, relationType: "supported_by_evidence", weight: parsed.evidenceStrength, ordinal: ordinal + 1, engineVersionId: created.action_engine_version_id });
      }
      actions.push(created);
    }
    return { actions, suppressed };
  }

  async generateActionVariants(workspaceId: string, actionId: string, productName: string, engine: DemandActionVariantEngine = new FixtureDemandActionVariantEngine()): Promise<ActionVariantRow[]> {
    const action = await this.repository.getAction(workspaceId, actionId);
    if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
    const actionType = actionTypeSchema.parse(action.action_type);
    const results = await engine.generate({ action: {
      actionType,
      targetKey: action.target_key,
      title: action.title,
      summary: action.summary,
      suggestedChange: action.suggested_change,
      currentState: action.current_state,
      targetMetric: action.target_metric ?? "",
      businessHypothesis: businessHypothesisSchema.parse(action.business_hypothesis),
      confidence: action.confidence,
      priorityScore: action.priority_score,
      why: action.why,
      inputFingerprint: action.input_fingerprint,
    }, actionId, productName });
    const variants: ActionVariantRow[] = [];
    for (const result of results) {
      const existing = await this.repository.findVariant(workspaceId, action.id, result.variantKey, result.inputFingerprint);
      if (existing) { variants.push(existing); continue; }
      const validatedContent = parseVariantContent(actionType, result.content);
      const variant = await this.repository.createVariant({
        id: deterministicUuid(`variant:${action.id}:${result.variantKey}:${result.inputFingerprint}`),
        workspace_id: workspaceId,
        product_id: action.product_id,
        action_id: action.id,
        evidence_node_id: deterministicUuid(`evidence:action-variant:${action.id}:${result.variantKey}:${result.inputFingerprint}`),
        variant_key: result.variantKey,
        label: result.label,
        content: json(validatedContent),
        rationale: result.rationale,
        status: "generated",
        variant_engine_version_id: deterministicUuid(`engine:action_variant:${engine.version}`),
        input_fingerprint: result.inputFingerprint,
      });
      await this.repository.linkProvenance({ derivedEvidenceNodeId: variant.evidence_node_id, sourceEvidenceNodeId: action.evidence_node_id, relationType: "variant_of", ordinal: variants.length, engineVersionId: variant.variant_engine_version_id });
      variants.push(variant);
    }
    return variants;
  }

  /**
   * Compare-and-set transition through the atomic `transition_action` RPC: the
   * status change, the action_events row and (for users) the audit_log row are
   * written in one transaction. Authorization, plan and basis revalidation are
   * the caller's responsibility (ActionLifecycleService for humans; the concept
   * Action pass for system expiry).
   */
  async transitionAction(input: { workspaceId: string; actionId: string; toStatus: ActionStatus; actorUserId?: string; actorKind?: "user" | "system" | "service"; metadata?: Record<string, unknown>; basisGuard?: ActionBasisGuardPayload | null; expectedFrom?: ActionStatus; traceId?: string }): Promise<ActionRow> {
    const parsedStatus = actionStatusSchema.safeParse(input.toStatus);
    if (!parsedStatus.success) throw new AppError("VALIDATION_ERROR", "Invalid Action status.");
    const action = await this.repository.getAction(input.workspaceId, input.actionId);
    if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
    const currentStatus = actionStatusSchema.safeParse(action.status);
    if (!currentStatus.success) throw new AppError("INTERNAL_ERROR", "Stored Action status is invalid.");
    const from = input.expectedFrom ?? currentStatus.data;
    if (!transitions[from].includes(parsedStatus.data)) throw new AppError("CONFLICT", `Action cannot transition from ${from} to ${parsedStatus.data}.`);
    return this.repository.transitionActionAtomic({
      workspaceId: input.workspaceId, actionId: input.actionId, from, to: parsedStatus.data,
      actorKind: input.actorKind ?? "system", actorUserId: input.actorUserId ?? null,
      metadata: jsonValueSchema.parse(input.metadata ?? {}) as JsonObject, basisGuard: input.basisGuard ?? null, traceId: input.traceId,
    });
  }

  async markStale(workspaceId: string, actionId: string, staleAt = now()): Promise<ActionRow> {
    const action = await this.repository.getAction(workspaceId, actionId);
    if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
    return this.repository.updateAction(workspaceId, actionId, { stale_at: staleAt });
  }

  async addFeedback(input: unknown): Promise<ActionFeedbackRow> {
    const parsed = actionFeedbackInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid Action feedback.", 422, { issues: parsed.error.issues });
    const action = await this.repository.getAction(parsed.data.workspaceId, parsed.data.actionId);
    if (!action || action.product_id !== parsed.data.productId) throw new AppError("FORBIDDEN", "The Action does not belong to this workspace/product.");
    const feedback = await this.repository.createFeedback({ workspace_id: parsed.data.workspaceId, product_id: parsed.data.productId, action_id: parsed.data.actionId, actor_user_id: parsed.data.actorUserId, feedback_type: parsed.data.feedbackType, reason: parsed.data.reason ?? null, metadata: json(parsed.data.metadata) });
    // Layer 10: feedback never approves a concept Action — approval must pass live basis revalidation (ActionLifecycleService).
    if (parsed.data.feedbackType === "approved" && action.status === "proposed" && !isConceptTriggerType(action.trigger_type)) await this.transitionAction({ workspaceId: action.workspace_id, actionId: action.id, toStatus: "approved", actorUserId: parsed.data.actorUserId });
    if (parsed.data.feedbackType === "dismissed" && action.status === "proposed") await this.transitionAction({ workspaceId: action.workspace_id, actionId: action.id, toStatus: "dismissed", actorUserId: parsed.data.actorUserId });
    return feedback;
  }

  async getFeedbackState(workspaceId: string, actionId: string) {
    const feedback = await this.repository.listFeedback(workspaceId, actionId);
    const latest = (types: ActionFeedbackType[]) => [...feedback].reverse().map((item) => ({ item, type: actionFeedbackTypeSchema.safeParse(item.feedback_type) })).find((entry) => entry.type.success && types.includes(entry.type.data));
    const lastParsed = feedback.at(-1) ? actionFeedbackTypeSchema.safeParse(feedback.at(-1)?.feedback_type) : null;
    const last = lastParsed?.success ? lastParsed.data : null;
    return { latest: last, useful: latest(["useful", "not_useful"])?.type.data === "useful" ? true : latest(["useful", "not_useful"])?.type.data === "not_useful" ? false : null, saved: latest(["saved"]) ? true : null, dismissed: latest(["dismissed"]) ? true : null };
  }

  async getAction(workspaceId: string, actionId: string): Promise<ActionReadModel> {
    const action = await this.repository.getAction(workspaceId, actionId);
    if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
    return this.readModel(action);
  }

  async listActions(workspaceId: string, productId: string, filters: ActionListFilters = {}): Promise<ActionReadModel[]> {
    const parsed = actionListFiltersSchema.parse(filters);
    const rows = await this.repository.listActions(workspaceId, productId, parsed);
    return Promise.all(rows.map((row) => this.readModel(row)));
  }

  async regenerateAction(input: ActionGenerationInput, engine: DemandActionEngine, supersedesActionId?: string): Promise<ActionGenerationOutput> {
    const output = await this.generateActions(input, engine);
    if (supersedesActionId && output.actions[0] && output.actions[0].id !== supersedesActionId) {
      await this.repository.createEvent({ workspace_id: input.workspaceId, product_id: output.actions[0].product_id, action_id: output.actions[0].id, actor_user_id: null, actor_kind: "system", event_type: "regenerated", from_status: null, to_status: output.actions[0].status, metadata: json({ supersedesActionId }) });
      const previous = await this.repository.getAction(input.workspaceId, supersedesActionId);
      if (previous && previous.status !== "superseded") {
        await this.transitionAction({ workspaceId: input.workspaceId, actionId: supersedesActionId, toStatus: "superseded", actorKind: "system" });
        await this.repository.updateAction(input.workspaceId, supersedesActionId, { superseded_by_action_id: output.actions[0].id });
      }
    }
    return output;
  }

  private async readModel(action: ActionRow): Promise<ActionReadModel> {
    const [variants, feedback, events, feedbackState] = await Promise.all([
      this.repository.listVariants(action.workspace_id, action.id),
      this.repository.listFeedback(action.workspace_id, action.id),
      this.repository.listEvents(action.workspace_id, action.id),
      this.getFeedbackState(action.workspace_id, action.id),
    ]);
    const evidenceContext = action.evidence_context;
    const supportingEvidenceNodeIds = evidenceContext && typeof evidenceContext === "object" && !Array.isArray(evidenceContext) && Array.isArray(evidenceContext.supportingEvidenceNodeIds)
      ? evidenceContext.supportingEvidenceNodeIds.filter((value): value is string => typeof value === "string")
      : [];
    return { action, variants, feedback, events, evidenceContext, feedbackState, provenance: { actionEvidenceNodeId: action.evidence_node_id, triggerEvidenceNodeId: action.trigger_evidence_node_id, supportingEvidenceNodeIds }, basisLifecycleStatus: actionBasisLifecycleStatus(this.options?.downstreamIntelligenceV2Enabled ?? false), liveBasis: null };
  }

  static inputFingerprint(input: ActionGenerationInput, engineVersion: string): string {
    return sha256Json({ input, engineVersion });
  }
}

export function transitionIsAllowed(from: ActionStatus, to: ActionStatus): boolean {
  return transitions[from].includes(to);
}
