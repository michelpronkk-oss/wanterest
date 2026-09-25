import type { ActionRow, JsonObject, ProductRow } from "../../db/database.helpers";
import { deterministicUuid } from "../ingestion/hash";
import { AppError } from "../../lib/errors";
import { CONCEPT_DRIFT_STATE_POLICY_VERSION, CONCEPT_GAP_STATE_POLICY_VERSION } from "../demand-intelligence/concept-market-state.policy";
import { CONCEPT_EPISODE_HISTORY_LIMIT, type ConceptMarketStateRepository, type ConceptMarketStateRow } from "../demand-intelligence/concept-market-state.repository";
import type { DemandMapConcept } from "../demand-intelligence/demand-map.policy";
import { jsonValueSchema } from "../../db/database.helpers";
import { ACTION_PRIORITY_FORMULA_VERSION, FixtureDemandActionEngine, type DemandActionEngine } from "./action.engines";
import { ACTION_APPROVAL_POLICY, ACTION_EXECUTION_MODE, isConceptTriggerType } from "./action.schemas";
import type { ActionRepository } from "./action.repository";
import { identityFor, loadConceptActionInputs, selectFromInputs, type ConceptActionInputPorts, type ConceptActionInputs } from "./concept-action.inputs";
import {
  conceptIdentityOf,
  driftStateQualifies,
  gapStateQualifies,
  type CanonicalConceptActionCandidate,
  type ConceptSelection,
} from "./concept-action.selector";

/** Layer 10: at most this many new Actions (creations + supersession replacements) per pass. */
export const MAX_NEW_CONCEPT_ACTIONS_PER_PASS = 5;

export type ConceptActionOutcome =
  | "created"
  | "superseded"
  | "expired"
  | "carried_forward"
  | "unchanged"
  | "pending"
  | "suppressed"
  | "deferred"
  | "failed";

export type ConceptActionAttempt = {
  conceptKey: string;
  clusteringVersion: string;
  outcome: ConceptActionOutcome;
  reason?: string;
  actionId?: string;
  replacedActionId?: string;
  triggerType?: "concept_gap" | "concept_drift";
  window?: string | null;
};

export type ConceptActionPassResult = {
  attempts: ConceptActionAttempt[];
  actionsCreated: number;
  actionsSuperseded: number;
  actionsExpired: number;
  actionsCarriedForward: number;
  warnings: string[];
};

type PlannedInsert = { candidate: CanonicalConceptActionCandidate; replace: ActionRow | null };

function json(value: unknown): JsonObject { return jsonValueSchema.parse(value) as JsonObject; }

function selectionMetadata(selection: ConceptSelection): JsonObject {
  if (selection.state === "pending") return json({ selection: "pending", reason: selection.reason });
  if (!selection.candidate) return json({ selection: "settled", candidate: null, reason: selection.reason ?? null });
  const candidate = selection.candidate;
  return json({ selection: "settled", triggerType: candidate.triggerType, basisStateId: candidate.basisStateId, window: candidate.window, proposalFingerprint: candidate.proposalFingerprint, basisGuard: candidate.basisGuard });
}

/**
 * Wanterest Layer 10 write-side Action pass: the ONLY writer of concept Actions.
 * For every canonical concept it runs the shared selector and reconciles the
 * (at most one) open Action against the canonical candidate: expire, carry
 * forward, atomically supersede, or create. Pending selections never write.
 * Plan and flag gating happen in the caller (action.orchestration.ts).
 * See docs/architecture.md Section 21.
 */
export class ConceptActionService {
  constructor(
    private readonly states: ConceptMarketStateRepository,
    private readonly actions: ActionRepository,
    private readonly ports: Omit<ConceptActionInputPorts, "states"> & { liveConcepts(workspaceId: string, productId: string, now: Date): Promise<DemandMapConcept[]> },
  ) {}

  async loadInputs(product: ProductRow, now: Date): Promise<ConceptActionInputs> {
    return loadConceptActionInputs({ ...this.ports, states: this.states }, product, now);
  }

  async reconcileAndGenerate(input: { product: ProductRow; now: Date; actionEngineVersionId: string; engine?: DemandActionEngine; traceId?: string }): Promise<ConceptActionPassResult> {
    const { product, now } = input;
    const engine = input.engine ?? new FixtureDemandActionEngine();
    const result: ConceptActionPassResult = { attempts: [], actionsCreated: 0, actionsSuperseded: 0, actionsExpired: 0, actionsCarriedForward: 0, warnings: [] };
    const inputs = await this.loadInputs(product, now);
    const openActions = await this.actions.listOpenConceptActions(product.workspace_id, product.id);

    // Canonical concept identities: every persisted market-state concept plus every open Action's concept.
    const identities = new Map<string, { clusteringVersion: string; anchorConceptKey: string }>();
    for (const key of inputs.markets.keys()) identities.set(`${inputs.clusteringVersion}\u0000${key}`, { clusteringVersion: inputs.clusteringVersion, anchorConceptKey: key });
    const openByIdentity = new Map<string, ActionRow>();
    for (const action of openActions) {
      const identity = conceptIdentityOf(action);
      if (!identity) continue;
      const key = `${identity.clusteringVersion}\u0000${identity.anchorConceptKey}`;
      identities.set(key, { clusteringVersion: identity.clusteringVersion, anchorConceptKey: identity.anchorConceptKey });
      openByIdentity.set(key, action);
    }

    const planned: PlannedInsert[] = [];
    for (const [key, concept] of [...identities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const identity = identityFor(inputs, concept.anchorConceptKey, concept.clusteringVersion);
      const selection = selectFromInputs(inputs, identity);
      const open = openByIdentity.get(key) ?? null;
      const base = { conceptKey: concept.anchorConceptKey, clusteringVersion: concept.clusteringVersion } as const;
      try {
        if (selection.state === "pending") { result.attempts.push({ ...base, outcome: "pending", reason: selection.reason, actionId: open?.id }); continue; }
        const candidate = selection.candidate;
        if (open) {
          if (!candidate) {
            if (open.status === "in_progress") { result.attempts.push({ ...base, outcome: "unchanged", reason: "in_progress_basis_invalid", actionId: open.id }); continue; }
            await this.actions.transitionActionAtomic({ workspaceId: open.workspace_id, actionId: open.id, from: open.status, to: "expired", actorKind: "system", metadata: json({ reason: selection.reason ?? "no_eligible_basis", ...selectionMetadata(selection) }), traceId: input.traceId });
            result.actionsExpired += 1;
            result.attempts.push({ ...base, outcome: "expired", reason: selection.reason, actionId: open.id });
            continue;
          }
          if (candidate.proposalFingerprint === open.proposal_fingerprint) {
            await this.carryForward(open, candidate, selection);
            result.actionsCarriedForward += 1;
            result.attempts.push({ ...base, outcome: "carried_forward", actionId: open.id, triggerType: candidate.triggerType, window: candidate.window });
            continue;
          }
          if (open.status === "in_progress") { result.attempts.push({ ...base, outcome: "unchanged", reason: "in_progress_proposal_changed", actionId: open.id }); continue; }
          planned.push({ candidate, replace: open });
          continue;
        }
        if (!candidate) continue;
        const suppression = await this.reproposalSuppressed(product, candidate, result.warnings);
        if (suppression) { result.attempts.push({ ...base, outcome: "suppressed", reason: suppression, triggerType: candidate.triggerType, window: candidate.window }); continue; }
        planned.push({ candidate, replace: null });
      } catch (error) {
        result.attempts.push({ ...base, outcome: "failed", reason: error instanceof Error ? error.message.slice(0, 180) : "failed", actionId: open?.id });
      }
    }

    // Bounded, deterministic: highest opportunity first, then concept key.
    planned.sort((left, right) => right.candidate.opportunity - left.candidate.opportunity || left.candidate.identity.anchorConceptKey.localeCompare(right.candidate.identity.anchorConceptKey));
    for (const [index, plan] of planned.entries()) {
      const base = { conceptKey: plan.candidate.identity.anchorConceptKey, clusteringVersion: plan.candidate.identity.clusteringVersion, triggerType: plan.candidate.triggerType, window: plan.candidate.window } as const;
      if (index >= MAX_NEW_CONCEPT_ACTIONS_PER_PASS) { result.attempts.push({ ...base, outcome: "deferred", reason: "max_new_actions_per_pass", actionId: plan.replace?.id }); continue; }
      try {
        const created = await this.createFromCandidate(product, plan, engine, input.actionEngineVersionId, input.traceId);
        if (plan.replace && created.id === plan.replace.id) throw new AppError("CONFLICT", "Replacement resolved to the Action it replaces.", 409, { reason: "action_replay_conflict" });
        if (plan.replace) { result.actionsSuperseded += 1; result.attempts.push({ ...base, outcome: "superseded", actionId: created.id, replacedActionId: plan.replace.id }); }
        else { result.actionsCreated += 1; result.attempts.push({ ...base, outcome: "created", actionId: created.id }); }
      } catch (error) {
        const reason = error instanceof AppError ? String(error.details?.reason ?? error.code) : error instanceof Error ? error.message.slice(0, 180) : "failed";
        result.attempts.push({ ...base, outcome: "failed", reason, actionId: plan.replace?.id });
      }
    }
    return result;
  }

  /** Case B: keep the Action; link the newer basis and record one idempotent revalidation event per new basis. */
  private async carryForward(open: ActionRow, candidate: CanonicalConceptActionCandidate, selection: ConceptSelection) {
    if (candidate.basisStateId === open.trigger_id) return;
    await this.actions.linkProvenance({ derivedEvidenceNodeId: open.evidence_node_id, sourceEvidenceNodeId: candidate.basisEvidenceNodeId, relationType: "revalidated_by", weight: 1, ordinal: 0, engineVersionId: open.action_engine_version_id });
    const last = await this.actions.latestEvent(open.workspace_id, open.id, "revalidated");
    const lastBasis = last?.metadata && typeof last.metadata === "object" && !Array.isArray(last.metadata) ? (last.metadata as Record<string, unknown>).basisStateId : null;
    if (lastBasis === candidate.basisStateId) return;
    await this.actions.createEvent({ workspace_id: open.workspace_id, product_id: open.product_id, action_id: open.id, actor_user_id: null, actor_kind: "system", event_type: "revalidated", from_status: open.status, to_status: open.status, metadata: json({ basisStateId: candidate.basisStateId, basisTriggerType: candidate.triggerType, window: candidate.window, proposalFingerprint: candidate.proposalFingerprint, ...selectionMetadata(selection) }) });
  }

  /**
   * After a USER dismissal or a completion, the same semantic proposal does not
   * reappear unless its fingerprint differs or a persisted non-qualifying state
   * (same trigger type, same drift window) came after the closed Action's basis.
   * System expiry/supersession/usage rejection never suppress.
   */
  private async reproposalSuppressed(product: ProductRow, candidate: CanonicalConceptActionCandidate, warnings: string[]): Promise<string | null> {
    const { identity } = candidate;
    const closed = await this.actions.latestClosedConceptAction(identity.workspaceId, identity.productId, identity.clusteringVersion, identity.anchorConceptKey);
    if (!closed || !(closed.status === "completed" || closed.status === "dismissed")) return null;
    if (closed.status === "dismissed") {
      const dismissal = await this.actions.latestEvent(closed.workspace_id, closed.id, "dismissed");
      if (dismissal?.actor_kind !== "user") return null;
    }
    if (closed.proposal_fingerprint !== candidate.proposalFingerprint) return null;
    const broke = await this.episodeBreakAfter(product, closed, warnings);
    return broke ? null : closed.status === "completed" ? "completed_by_user" : "dismissed_by_user";
  }

  private async episodeBreakAfter(product: ProductRow, closed: ActionRow, warnings: string[]): Promise<boolean> {
    const identity = conceptIdentityOf(closed);
    if (!identity || !isConceptTriggerType(closed.trigger_type)) return false;
    const { workspaceId, productId, clusteringVersion, anchorConceptKey } = identity;
    if (closed.trigger_type === "concept_gap") {
      const basis = await this.states.getGapState(workspaceId, productId, closed.trigger_id);
      if (!basis) return false;
      const later = await this.states.listGapStatesAfter(workspaceId, productId, clusteringVersion, anchorConceptKey, CONCEPT_GAP_STATE_POLICY_VERSION, basis.sequence, CONCEPT_EPISODE_HISTORY_LIMIT);
      const markets = await this.marketsById(workspaceId, productId, later.map((row) => row.market_state_id));
      if (later.some((row) => { const market = markets.get(row.market_state_id); return market ? !gapStateQualifies(product, row, market) : false; })) return true;
      if (later.length >= CONCEPT_EPISODE_HISTORY_LIMIT) warnings.push(`Episode-break lookup for ${anchorConceptKey} reached its ${CONCEPT_EPISODE_HISTORY_LIMIT}-state cap without a break; treated as no break.`);
      return false;
    }
    const basis = await this.states.getDriftState(workspaceId, productId, closed.trigger_id);
    if (!basis) return false;
    const later = await this.states.listDriftStatesAfter(workspaceId, productId, clusteringVersion, anchorConceptKey, CONCEPT_DRIFT_STATE_POLICY_VERSION, basis.window_type, basis.sequence, CONCEPT_EPISODE_HISTORY_LIMIT);
    const markets = await this.marketsById(workspaceId, productId, later.map((row) => row.market_state_id));
    if (later.some((row) => { const market = markets.get(row.market_state_id); return market ? !driftStateQualifies(product, row, market) : false; })) return true;
    if (later.length >= CONCEPT_EPISODE_HISTORY_LIMIT) warnings.push(`Episode-break lookup for ${anchorConceptKey} reached its ${CONCEPT_EPISODE_HISTORY_LIMIT}-state cap without a break; treated as no break.`);
    return false;
  }

  private async marketsById(workspaceId: string, productId: string, ids: string[]): Promise<Map<string, ConceptMarketStateRow>> {
    return new Map((await this.states.getMarketStatesByIds(workspaceId, productId, ids)).map((row) => [row.id, row]));
  }

  private async createFromCandidate(product: ProductRow, plan: PlannedInsert, engine: DemandActionEngine, actionEngineVersionId: string, traceId?: string): Promise<ActionRow> {
    const { candidate } = plan;
    const [generated] = await engine.generate(candidate.input);
    if (!generated) throw new AppError("CONFLICT", "The Action engine declined the canonical candidate.", 409, { reason: "actions_engine_declined" });
    // Replay-stable (same basis + same semantic proposal → same key); including the proposal fingerprint
    // guarantees a changed proposal on an unchanged basis row can never resolve to the Action it replaces.
    const idempotencyKey = `action:${product.id}:${candidate.triggerType}:${candidate.basisStateId}:${engine.version}:${candidate.proposalFingerprint}`;
    // Deterministic id is only a first-insert hint; the RPC resolves replays by (workspace_id, idempotency_key).
    const actionId = deterministicUuid(`${idempotencyKey}:${generated.inputFingerprint}`);
    const measurements = { marketWeight: candidate.input.marketWeight, gapScore: candidate.input.gapScore, driftStrength: candidate.input.driftStrength, opportunityScore: candidate.input.opportunityScore, sampleSize: candidate.input.sampleSize, sampleQuality: candidate.input.sampleQuality };
    return this.actions.createConceptAction({
      action: {
        id: actionId, workspace_id: product.workspace_id, product_id: product.id, evidence_node_id: deterministicUuid(`evidence:action:${actionId}`),
        action_type: generated.actionType, trigger_type: candidate.triggerType, trigger_id: candidate.basisStateId, trigger_evidence_node_id: candidate.basisEvidenceNodeId,
        trigger_concept_key: candidate.identity.anchorConceptKey, trigger_clustering_version: candidate.identity.clusteringVersion, proposal_fingerprint: candidate.proposalFingerprint,
        target_key: generated.targetKey, title: generated.title, summary: generated.summary, why: generated.why, suggested_change: generated.suggestedChange,
        current_state: generated.currentState, target_metric: generated.targetMetric, business_hypothesis: json(generated.businessHypothesis),
        evidence_context: json({ buyerLanguage: candidate.input.buyerLanguage, supportingEvidenceNodeIds: [], window: candidate.window, measurements }),
        priority_score: Math.max(0, Math.min(1, generated.priorityScore)), confidence: Math.max(0, Math.min(1, generated.confidence)), status: "proposed",
        action_engine_version_id: actionEngineVersionId, priority_formula_version: ACTION_PRIORITY_FORMULA_VERSION, input_fingerprint: generated.inputFingerprint, idempotency_key: idempotencyKey,
      },
      supersedeActionId: plan.replace?.id ?? null,
      expectedStatus: plan.replace?.status ?? null,
      basisGuard: candidate.basisGuard,
      provenanceWeight: candidate.input.evidenceStrength,
      eventMetadata: json({ approvalPolicy: ACTION_APPROVAL_POLICY, executionMode: ACTION_EXECUTION_MODE, basisStateId: candidate.basisStateId, triggerType: candidate.triggerType, window: candidate.window, proposalFingerprint: candidate.proposalFingerprint }),
      traceId,
    });
  }
}
