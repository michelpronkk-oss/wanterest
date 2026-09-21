import { requireUser } from "../auth";
import { getProductQuery } from "../products";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import type { ActionGenerationInput, ActionListFilters, ActionStatus } from "./action.schemas";
import type { DemandActionEngine, DemandActionVariantEngine } from "./action.engines";
import { DemandActionService, type ActionReadModel } from "./action.service";
import { SupabaseActionRepository } from "./action.repository";

export const ACTION_JOB_TYPES = ["generate-actions", "build-digest"] as const;
export type ActionJobType = (typeof ACTION_JOB_TYPES)[number];

function readService() {
  return new DemandActionService(new SupabaseActionRepository(createSupabaseServiceClient()), { can: async () => true });
}

/** Thin read wrapper over DemandActionService.listActions — no priority/scoring logic here. */
export async function listActionsQuery(workspaceId: unknown, productId: unknown, filters?: ActionListFilters): Promise<ActionReadModel[]> {
  const product = await getProductQuery(workspaceId, productId);
  await requireUser();
  return readService().listActions(product.workspace_id, product.id, filters);
}

/** Thin read wrapper over DemandActionService.getAction — no priority/scoring logic here. */
export async function getActionQuery(workspaceId: string, actionId: string): Promise<ActionReadModel> {
  await requireUser();
  return readService().getAction(workspaceId, actionId);
}

/** Reuses DemandActionService.transitionAction's existing allowed-transition table — no new status logic here. */
export async function transitionActionCommand(workspaceId: string, actionId: string, toStatus: ActionStatus) {
  const user = await requireUser();
  return readService().transitionAction({ workspaceId, actionId, toStatus, actorUserId: user.id, actorKind: "user" });
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

