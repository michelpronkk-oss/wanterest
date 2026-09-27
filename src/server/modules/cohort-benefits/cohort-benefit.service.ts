import "server-only";

import { cache } from "react";
import { z } from "zod";

import { requireUser } from "@/server/modules/auth";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { AppError } from "@/server/lib/errors";
import type { CohortName } from "../cohorts/cohort-membership.schemas";
import { policyForCohort } from "./cohort-benefit.policies";
import { createSupabaseCohortBenefitRepository, type CohortBenefitRepository } from "./cohort-benefit.repository";
import type { CohortBenefitReadModel } from "./cohort-benefit.schemas";

export type PaidBenefitActivationInput = {
  workspaceId: string;
  subscriptionId: string;
  providerEventId: string;
  activatedAt: string;
  actorUserId?: string | null;
};

export type CohortBenefitActivationPort = {
  activateFromSuccessfulPaidSubscription(input: PaidBenefitActivationInput): Promise<{ status: "activated" | "already_active" | "not_eligible" | "expired" | "revoked" }>;
};

export class CohortBenefitService implements CohortBenefitActivationPort {
  constructor(private readonly repository: CohortBenefitRepository = createSupabaseCohortBenefitRepository()) {}

  async grantForAdmission(input: { workspaceId: string; membershipId: string; cohort: CohortName; actorUserId?: string | null }) {
    const policy = policyForCohort(input.cohort);
    return this.repository.grant({
      workspaceId: input.workspaceId,
      membershipId: input.membershipId,
      policyKey: policy.policyKey,
      discountPercent: policy.discountPercent,
      durationMonths: policy.durationMonths,
      actorUserId: input.actorUserId,
    });
  }

  async activateFromSuccessfulPaidSubscription(input: PaidBenefitActivationInput) {
    const current = await this.repository.getReadModel(input.workspaceId);
    if (!current.membershipId || current.cohort === "none") return { status: "not_eligible" as const };
    const policy = policyForCohort(current.cohort);
    if (!current.benefit) {
      await this.repository.grant({
        workspaceId: input.workspaceId,
        membershipId: current.membershipId,
        policyKey: policy.policyKey,
        discountPercent: policy.discountPercent,
        durationMonths: policy.durationMonths,
        actorUserId: input.actorUserId,
      });
    }
    const activated = await this.repository.activate(input);
    if (activated.status === "active" && activated.changed) return { status: "activated" as const };
    if (activated.status === "active") return { status: "already_active" as const };
    if (activated.status === "expired") return { status: "expired" as const };
    return { status: "revoked" as const };
  }

  async revoke(input: { workspaceId: string; reason: string; actorUserId?: string | null }) {
    const parsed = z.object({ workspaceId: z.string().uuid(), reason: z.string().trim().min(1).max(240), actorUserId: z.string().uuid().nullable().optional() }).safeParse(input);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid cohort benefit revocation.", 422);
    return this.repository.revoke(parsed.data);
  }
}

export function createCohortBenefitService(repository?: CohortBenefitRepository): CohortBenefitService {
  return new CohortBenefitService(repository);
}

export const getWorkspaceCohortBenefitQuery = cache(async function getWorkspaceCohortBenefitQuery(workspaceId: unknown): Promise<CohortBenefitReadModel> {
  const parsed = z.string().uuid().safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  await requireUser();
  return createSupabaseCohortBenefitRepository(await createSupabaseServerClient()).getReadModel(parsed.data);
});
