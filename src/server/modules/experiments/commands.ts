import "server-only";

import { requireUser } from "../auth";
import { can, consume, limit } from "../entitlements";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseActionRepository } from "../actions/action.repository";
import { ExperimentService, type InternalExperimentEventInput } from "./experiment.service";
import { SupabaseExperimentRepository } from "./experiment.repository";
import { recordAuditEvent } from "../observability/audit.service";

function service() {
  const repository = new SupabaseExperimentRepository(createSupabaseServiceClient());
  const actions = new SupabaseActionRepository(createSupabaseServiceClient());
  return new ExperimentService({ repository, actions, entitlements: { can, limit, consume: async (workspaceId, input) => consume(workspaceId, input) }, audit: async (input) => { if (!input.actorUserId) return; await recordAuditEvent({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, actorKind: "user", action: input.action, targetType: "experiments", targetId: input.targetId, metadata: input.metadata ?? {} }); } });
}

export async function createExperimentCommand(input: unknown) { const user = await requireUser(); return service().createExperiment({ ...(input as object), createdBy: user.id }); }
export async function createExperimentVariantCommand(input: unknown) { await requireUser(); return service().createVariant(input); }
export async function transitionExperimentCommand(input: unknown) { const user = await requireUser(); return service().transition({ ...(input as object), actorUserId: user.id }); }
export async function getActiveExperimentsQuery(workspaceId: string, productId?: string) { await requireUser(); return service().getActiveExperiments(workspaceId, productId); }
export async function assignExperimentVariantCommand(input: unknown) { await requireUser(); return service().assignVariant(input); }
export async function issueExperimentTokenCommand(workspaceId: string, experimentId: string) { const user = await requireUser(); const issued = await service().issuePublicToken(workspaceId, experimentId); await recordAuditEvent({ workspaceId, actorUserId: user.id, actorKind: "user", action: "experiment.public_token_issued", targetType: "experiment_public_tokens", targetId: issued.record.id }); return issued; }
export async function revokeExperimentTokenCommand(workspaceId: string, tokenId: string) { const user = await requireUser(); const revoked = await service().revokePublicToken(workspaceId, tokenId); await recordAuditEvent({ workspaceId, actorUserId: user.id, actorKind: "user", action: "experiment.public_token_revoked", targetType: "experiment_public_tokens", targetId: tokenId }); return revoked; }
export async function recordExperimentExposureCommand(input: InternalExperimentEventInput) { return service().recordExposureForAssignment(input); }
export async function recordExperimentOutcomeCommand(input: InternalExperimentEventInput) { return service().recordOutcomeForAssignment(input); }
export async function recomputeExperimentResultsCommand(workspaceId: string, experimentId: string) { await requireUser(); return service().recomputeResults(workspaceId, experimentId); }
