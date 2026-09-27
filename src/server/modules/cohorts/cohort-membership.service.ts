import "server-only";

import { cache } from "react";
import { z } from "zod";

import { requireUser } from "@/server/modules/auth";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { AppError } from "@/server/lib/errors";
import {
  cohortAssignmentInputSchema,
  type CohortAssignment,
  type WorkspaceCohortIdentity,
} from "./cohort-membership.schemas";
import {
  createSupabaseCohortMembershipRepository,
  type CohortMembershipRepository,
} from "./cohort-membership.repository";

export class CohortMembershipService {
  constructor(private readonly repository: CohortMembershipRepository = createSupabaseCohortMembershipRepository()) {}

  /**
   * Controlled admission seam. There is intentionally no public route or
   * browser-facing command that accepts a requested cohort or number.
   */
  async assignAtAdmission(input: unknown): Promise<CohortAssignment> {
    const parsed = cohortAssignmentInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid workspace cohort assignment.", 422, { issues: parsed.error.issues });
    }
    if (this.repository.assignAtAdmissionWithBenefit) return this.repository.assignAtAdmissionWithBenefit(parsed.data);
    return this.repository.assignAtAdmission(parsed.data);
  }
}

export function createCohortMembershipService(repository?: CohortMembershipRepository): CohortMembershipService {
  return new CohortMembershipService(repository);
}

/** Authenticated private read model; the database RPC performs membership authorization. */
export const getWorkspaceCohortIdentityQuery = cache(async function getWorkspaceCohortIdentityQuery(
  workspaceId: unknown,
): Promise<WorkspaceCohortIdentity> {
  const parsedWorkspaceId = z.string().uuid().safeParse(workspaceId);
  if (!parsedWorkspaceId.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  await requireUser();
  return createSupabaseCohortMembershipRepository(await createSupabaseServerClient()).getWorkspaceIdentity(parsedWorkspaceId.data);
});
