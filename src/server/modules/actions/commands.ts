import type { ActionGenerationInput, ActionListFilters } from "./action.schemas";
import type { DemandActionEngine, DemandActionVariantEngine } from "./action.engines";
import type { DemandActionService } from "./action.service";

export const ACTION_JOB_TYPES = ["generate-actions", "build-digest"] as const;
export type ActionJobType = (typeof ACTION_JOB_TYPES)[number];

export function generateActions(service: DemandActionService, input: ActionGenerationInput, engine?: DemandActionEngine) {
  return service.generateActions(input, engine);
}

export function generateActionVariants(service: DemandActionService, workspaceId: string, actionId: string, productName: string, engine?: DemandActionVariantEngine) {
  return service.generateActionVariants(workspaceId, actionId, productName, engine);
}

export function listActions(service: DemandActionService, workspaceId: string, productId: string, filters?: ActionListFilters) {
  return service.listActions(workspaceId, productId, filters);
}

