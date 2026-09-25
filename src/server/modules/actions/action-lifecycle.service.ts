import { z } from "zod";

import type { ActionRow, JsonObject, ProductRow } from "../../db/database.helpers";
import { jsonValueSchema } from "../../db/database.helpers";
import { AppError } from "../../lib/errors";
import { ACTION_APPROVAL_POLICY, ACTION_EXECUTION_MODE, isConceptTriggerType, isOpenActionStatus, type ActionStatus, type UserActionTransition } from "./action.schemas";
import type { DemandActionService } from "./action.service";
import type { ActionBasisGuardPayload } from "./action.repository";
import { selectFromInputs, type ConceptActionInputs } from "./concept-action.inputs";
import { conceptIdentityOf, evaluateActionLiveBasis, type ActionLiveBasis, type ConceptSelection } from "./concept-action.selector";

/**
 * Wanterest Layer 10 human Action lifecycle + live read evaluation.
 *
 * Authorization contract (fixes the service-role IDOR): the Action is loaded
 * through the user's RLS-scoped client, its own workspace/product are the only
 * scope ever used, membership and role are verified before any service-role
 * write, and a browser-supplied workspace id authorizes nothing.
 * See docs/architecture.md Section 21.
 */

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export const ACTION_MUTATING_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "member"];

export type ActionAccessPorts = {
  currentUser(): Promise<{ id: string } | null>;
  /** RLS/user-scoped read: returns null for non-existent AND for other tenants' Actions. */
  loadActionAsUser(actionId: string): Promise<ActionRow | null>;
  /** RLS/user-scoped read of the caller's own membership row. */
  loadMembershipAsUser(workspaceId: string, userId: string): Promise<{ role: string; status: string } | null>;
};

export type ActionAccess = { userId: string; action: ActionRow; role: WorkspaceRole; canMutate: boolean };

/**
 * Resolves an Action for a signed-in user. Absent, cross-tenant, or inactive
 * membership all return the identical NOT_FOUND (existence is never leaked).
 * `mutate` additionally requires a non-viewer role.
 */
export async function authorizeActionAccess(ports: ActionAccessPorts, actionId: unknown, mode: "read" | "mutate"): Promise<ActionAccess> {
  const user = await ports.currentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Authentication is required.");
  const parsedId = z.string().uuid().safeParse(actionId);
  if (!parsedId.success) throw new AppError("NOT_FOUND", "Action was not found.");
  const action = await ports.loadActionAsUser(parsedId.data);
  if (!action) throw new AppError("NOT_FOUND", "Action was not found.");
  const membership = await ports.loadMembershipAsUser(action.workspace_id, user.id);
  if (!membership || membership.status !== "active") throw new AppError("NOT_FOUND", "Action was not found.");
  const role = membership.role as WorkspaceRole;
  const canMutate = ACTION_MUTATING_ROLES.includes(role);
  if (mode === "mutate" && !canMutate) throw new AppError("FORBIDDEN", "Viewers can read Actions but cannot change them.");
  return { userId: user.id, action, role, canMutate };
}

export type ActionLifecycleDependencies = {
  actionService: DemandActionService;
  actionsEnabled(workspaceId: string): Promise<boolean>;
  loadProduct(workspaceId: string, productId: string): Promise<ProductRow>;
  loadConceptInputs(product: ProductRow, now: Date): Promise<ConceptActionInputs>;
  downstreamIntelligenceV2Enabled: boolean;
  /** Layer 11 EXPERIMENT_MEASUREMENT_ENABLED: passed to transition_action so a ready experiment may start. */
  experimentMeasurementEnabled?: boolean;
  now(): Date;
};

function json(value: unknown): JsonObject { return jsonValueSchema.parse(value) as JsonObject; }

function conflict(message: string, reason: string): AppError { return new AppError("CONFLICT", message, 409, { reason }); }

export class ActionLifecycleService {
  constructor(private readonly deps: ActionLifecycleDependencies) {}

  /** Canonical selection for one concept Action (read-only; no writes). */
  private async selectionFor(action: ActionRow, now: Date): Promise<ConceptSelection | null> {
    const identity = conceptIdentityOf(action);
    if (!identity) return null;
    const product = await this.deps.loadProduct(action.workspace_id, action.product_id);
    const inputs = await this.deps.loadConceptInputs(product, now);
    return selectFromInputs(inputs, identity);
  }

  /**
   * Batched, read-only live basis evaluation for list/detail. One bounded input
   * load and one entitlement read per product, no writes, no per-Action queries.
   */
  async evaluate(actions: ActionRow[], context: { canMutate: boolean }): Promise<Map<string, ActionLiveBasis>> {
    const now = this.deps.now();
    const result = new Map<string, ActionLiveBasis>();
    const byProduct = new Map<string, ActionRow[]>();
    for (const action of actions) {
      const key = `${action.workspace_id}:${action.product_id}`;
      byProduct.set(key, [...(byProduct.get(key) ?? []), action]);
    }
    for (const rows of byProduct.values()) {
      const [first] = rows;
      const actionsEnabled = await this.deps.actionsEnabled(first.workspace_id);
      const needsSelection = rows.some((row) => isConceptTriggerType(row.trigger_type) && isOpenActionStatus(row.status));
      const inputs = needsSelection ? await this.deps.loadConceptInputs(await this.deps.loadProduct(first.workspace_id, first.product_id), now) : null;
      for (const action of rows) {
        const identity = conceptIdentityOf(action);
        const selection = inputs && identity && isOpenActionStatus(action.status) ? selectFromInputs(inputs, identity) : null;
        result.set(action.id, evaluateActionLiveBasis({ action, selection, actionsEnabled, downstreamIntelligenceV2Enabled: this.deps.downstreamIntelligenceV2Enabled, canMutate: context.canMutate }));
      }
    }
    return result;
  }

  /**
   * Layer 11: read-only Layer 10 revalidation before an experiment is created
   * for an approved Action (plan gate, settled canonical selection with a
   * candidate, current proposal fingerprint). Returns the basis guard the
   * create RPC re-checks in its own transaction; never writes (no expiry).
   */
  async revalidateForMeasurement(action: ActionRow): Promise<ActionBasisGuardPayload | null> {
    if (!(await this.deps.actionsEnabled(action.workspace_id))) {
      throw new AppError("CAPABILITY_DISABLED", "Actions are not enabled for this workspace plan.", 403, { capability: "actions_enabled" });
    }
    if (!isConceptTriggerType(action.trigger_type)) {
      throw conflict("Only lifecycle-verified Actions can be measured.", "legacy_basis_not_verified");
    }
    const selection = await this.selectionFor(action, this.deps.now());
    if (!selection || selection.state === "pending") {
      throw conflict("The evidence behind this Action changed and is being re-analysed. Try again after the next update.", `basis_update_pending:${selection?.state === "pending" ? selection.reason : "unknown"}`);
    }
    if (!selection.candidate) throw conflict("The evidence behind this Action is no longer valid.", "basis_invalid");
    if (selection.candidate.proposalFingerprint !== action.proposal_fingerprint) throw conflict("A newer recommendation replaces this one.", "newer_recommendation");
    return selection.candidate.basisGuard;
  }

  /**
   * Human transition. Approve/start: plan gate + canonical-selector revalidation
   * + fingerprint equality, then the RPC re-checks the basis guard in the same
   * transaction. Complete/dismiss: auth/membership/role only (already checked).
   */
  async transition(access: ActionAccess, request: { toStatus: UserActionTransition; note?: string; liveSince?: string }, traceId?: string): Promise<ActionRow> {
    if (!access.canMutate) throw new AppError("FORBIDDEN", "Viewers can read Actions but cannot change them.");
    const { action } = access;
    const from = action.status as ActionStatus;
    const baseMetadata: Record<string, unknown> = { approvalPolicy: ACTION_APPROVAL_POLICY, executionMode: ACTION_EXECUTION_MODE, ...(request.note ? { note: request.note } : {}) };
    // Layer 11: completion metadata carries the go-live date; the RPC validates it against a running experiment's window.
    if (request.toStatus === "completed" && request.liveSince) baseMetadata.liveSince = new Date(request.liveSince).toISOString();
    // Layer 11: the single start path; the database starts or cancels a ready experiment in the same transaction.
    const experimentStartsAllowed = request.toStatus === "in_progress" && this.deps.experimentMeasurementEnabled === true;
    const common = { workspaceId: action.workspace_id, actionId: action.id, actorUserId: access.userId, actorKind: "user" as const, expectedFrom: from, traceId, ...(experimentStartsAllowed ? { experimentStartsAllowed } : {}) };

    if (request.toStatus === "completed" || request.toStatus === "dismissed") {
      return this.deps.actionService.transitionAction({ ...common, toStatus: request.toStatus, metadata: baseMetadata });
    }

    if (!(await this.deps.actionsEnabled(action.workspace_id))) {
      throw new AppError("CAPABILITY_DISABLED", "Actions are not enabled for this workspace plan.", 403, { capability: "actions_enabled" });
    }
    if (!isConceptTriggerType(action.trigger_type)) {
      if (this.deps.downstreamIntelligenceV2Enabled) throw conflict("This Action has no lifecycle-verified basis and can only be dismissed.", "legacy_basis_not_verified");
      return this.deps.actionService.transitionAction({ ...common, toStatus: request.toStatus, metadata: baseMetadata });
    }

    const now = this.deps.now();
    const selection = await this.selectionFor(action, now);
    if (!selection || selection.state === "pending") {
      throw conflict("The evidence behind this Action changed and is being re-analysed. Try again after the next update.", `basis_update_pending:${selection?.state === "pending" ? selection.reason : "unknown"}`);
    }
    if (!selection.candidate) {
      if (from === "proposed" || from === "approved") {
        try {
          await this.deps.actionService.transitionAction({ workspaceId: action.workspace_id, actionId: action.id, toStatus: "expired", actorKind: "system", expectedFrom: from, metadata: json({ reason: selection.reason ?? "no_eligible_basis", trigger: "revalidation_at_transition" }), traceId });
        } catch (error) {
          if (!(error instanceof AppError && error.code === "CONFLICT")) throw error;
        }
      }
      throw conflict("The evidence behind this Action is no longer valid, so it has expired.", "basis_invalid");
    }
    if (selection.candidate.proposalFingerprint !== action.proposal_fingerprint) {
      throw conflict("A newer recommendation replaces this one.", "newer_recommendation");
    }
    const candidate = selection.candidate;
    return this.deps.actionService.transitionAction({
      ...common,
      toStatus: request.toStatus,
      basisGuard: candidate.basisGuard,
      metadata: json({ ...baseMetadata, revalidation: { checkedAt: now.toISOString(), basisTriggerType: candidate.triggerType, basisStateId: candidate.basisStateId, window: candidate.window, proposalFingerprint: candidate.proposalFingerprint, basisGuard: candidate.basisGuard } }),
    });
  }
}
