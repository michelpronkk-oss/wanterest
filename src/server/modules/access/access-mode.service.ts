import "server-only";

import { AppError } from "@/server/lib/errors";
import { accessModeChangeInputSchema, type AccessMode, type PublicAccessState } from "./access-mode.schemas";
import { createSupabaseAccessModeRepository, type AccessModeRepository } from "./access-mode.repository";
import { getAccessPolicy } from "./access-mode.policy";

export async function getProductAccessState(repository?: AccessModeRepository): Promise<PublicAccessState> {
  return (repository ?? createSupabaseAccessModeRepository()).getPublicState();
}
export async function getProductAccessPolicy(repository?: AccessModeRepository) {
  const state = await getProductAccessState(repository);
  return getAccessPolicy(state.mode);
}

/** Internal/operator seam. No public route or workspace-admin capability calls this. */
export async function setProductAccessMode(input: unknown, repository?: AccessModeRepository) {
  const parsed = accessModeChangeInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "The access mode change is invalid.");
  return (repository ?? createSupabaseAccessModeRepository()).setMode({
    mode: parsed.data.mode as AccessMode,
    reason: parsed.data.reason,
    actorUserId: parsed.data.actorUserId ?? null,
  });
}
