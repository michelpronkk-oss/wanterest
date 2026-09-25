import { getCurrentUser } from "../auth";
import { getProductQuery } from "../products";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { createSupabaseServerClient } from "../../providers/supabase/server";
import { getServerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import type { ProductRow } from "../../db/database.helpers";
import { capabilityAllows } from "../entitlements/entitlement-policy";
import { getWorkspaceEntitlement } from "../entitlements/entitlement.repository";
import { SupabaseConceptMarketStateRepository } from "../demand-intelligence/concept-market-state.repository";
import { actionTransitionRequestSchema, type ActionGenerationInput, type ActionListFilters } from "./action.schemas";
import type { DemandActionEngine, DemandActionVariantEngine } from "./action.engines";
import { DemandActionService, type ActionReadModel } from "./action.service";
import { SupabaseActionRepository } from "./action.repository";
import { ActionLifecycleService, ACTION_MUTATING_ROLES, authorizeActionAccess, type ActionAccessPorts, type WorkspaceRole } from "./action-lifecycle.service";
import { loadConceptActionInputs } from "./concept-action.inputs";
import { conceptActionInputPorts } from "./action.orchestration";

export const ACTION_JOB_TYPES = ["generate-actions", "build-digest"] as const;
export type ActionJobType = (typeof ACTION_JOB_TYPES)[number];

function downstreamV2Enabled(): boolean {
  return getServerEnv().DOWNSTREAM_INTELLIGENCE_V2_ENABLED === "true";
}

function readService() {
  return new DemandActionService(new SupabaseActionRepository(createSupabaseServiceClient()), { can: async () => true }, undefined, { downstreamIntelligenceV2Enabled: downstreamV2Enabled() });
}

/** Service-role wiring used only AFTER the caller has been authorized against the Action's own workspace. */
function lifecycleService(): ActionLifecycleService {
  const client = createSupabaseServiceClient();
  const repository = new SupabaseActionRepository(client);
  return new ActionLifecycleService({
    actionService: new DemandActionService(repository, undefined, undefined, { downstreamIntelligenceV2Enabled: downstreamV2Enabled() }),
    actionsEnabled: async (workspaceId) => capabilityAllows((await getWorkspaceEntitlement(client, workspaceId, "actions_enabled")).value),
    loadProduct: async (workspaceId, productId) => {
      const { data, error } = await client.from("products").select("*").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle();
      if (error || !data) throw new AppError("NOT_FOUND", "Product was not found.");
      return data as ProductRow;
    },
    loadConceptInputs: (product, now) => loadConceptActionInputs({ ...conceptActionInputPorts(client), states: new SupabaseConceptMarketStateRepository(client) }, product, now),
    downstreamIntelligenceV2Enabled: downstreamV2Enabled(),
    now: () => new Date(),
  });
}

/** RLS/user-scoped reads only — never the service role — so a foreign Action id resolves to nothing. */
async function actionAccessPorts(): Promise<ActionAccessPorts> {
  const client = await createSupabaseServerClient();
  return {
    currentUser: async () => { const user = await getCurrentUser(); return user ? { id: user.id } : null; },
    loadActionAsUser: async (actionId) => {
      const { data, error } = await client.from("actions").select("*").eq("id", actionId).maybeSingle();
      if (error) throw new AppError("INTERNAL_ERROR", "Action could not be loaded.");
      return data;
    },
    loadMembershipAsUser: async (workspaceId, userId) => {
      const { data, error } = await client.from("workspace_members").select("role,status").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
      if (error) throw new AppError("INTERNAL_ERROR", "Workspace membership could not be loaded.");
      return data;
    },
  };
}

async function callerCanMutate(workspaceId: string): Promise<boolean> {
  const ports = await actionAccessPorts();
  const user = await ports.currentUser();
  if (!user) return false;
  const membership = await ports.loadMembershipAsUser(workspaceId, user.id);
  return Boolean(membership && membership.status === "active" && ACTION_MUTATING_ROLES.includes(membership.role as WorkspaceRole));
}

/**
 * Product-scoped list. Membership is enforced by the RLS-backed product lookup;
 * every open concept Action carries its live, read-only basis status (batched,
 * no writes).
 */
export async function listActionsQuery(workspaceId: unknown, productId: unknown, filters?: ActionListFilters): Promise<ActionReadModel[]> {
  const product = await getProductQuery(workspaceId, productId);
  const models = await readService().listActions(product.workspace_id, product.id, filters);
  if (!models.length) return models;
  const live = await lifecycleService().evaluate(models.map((model) => model.action), { canMutate: await callerCanMutate(product.workspace_id) });
  return models.map((model) => ({ ...model, liveBasis: live.get(model.action.id) ?? null }));
}

/** Detail by Action id only; scope is derived from the Action itself through RLS. */
export async function getActionQuery(actionId: unknown): Promise<ActionReadModel> {
  const access = await authorizeActionAccess(await actionAccessPorts(), actionId, "read");
  const model = await readService().getAction(access.action.workspace_id, access.action.id);
  const live = await lifecycleService().evaluate([model.action], { canMutate: access.canMutate });
  return { ...model, liveBasis: live.get(model.action.id) ?? null };
}

/**
 * Human transition. The browser sends only { actionId, toStatus, note? } — a
 * workspace id is rejected by the strict schema and never used for scope.
 */
export async function transitionActionCommand(input: unknown) {
  const parsed = actionTransitionRequestSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "The Action update is invalid.");
  const access = await authorizeActionAccess(await actionAccessPorts(), parsed.data.actionId, "mutate");
  return lifecycleService().transition(access, { toStatus: parsed.data.toStatus, note: parsed.data.note });
}

export function generateActions(service: DemandActionService, input: ActionGenerationInput, engine?: DemandActionEngine) {
  return service.generateActions(input, engine);
}

export function generateActionVariants(service: DemandActionService, workspaceId: string, actionId: string, productName: string, engine?: DemandActionVariantEngine) {
  return service.generateActionVariants(workspaceId, actionId, productName, engine);
}

export function listActions(service: DemandActionService, workspaceId: string, productId: string, filters?: ActionListFilters) {
  return service.listActions(workspaceId, productId, filters);
}
