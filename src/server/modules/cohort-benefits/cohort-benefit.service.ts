import "server-only";

import { cache } from "react";
import { z } from "zod";

import { requireUser } from "@/server/modules/auth";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { AppError } from "@/server/lib/errors";
import type { CohortName } from "../cohorts/cohort-membership.schemas";
import type { BillingInterval } from "../billing/billing.schemas";
import { getRemainingEligibleDiscountCycles, initialDiscountCycles } from "./cohort-benefit.cycles";
import { policyForCohort } from "./cohort-benefit.policies";
import { createSupabaseCohortBenefitRepository, type CohortBenefitRepository } from "./cohort-benefit.repository";
import type { CohortBenefitReadModel } from "./cohort-benefit.schemas";

export type CohortBenefitProviderPort = {
  createDiscount(input: {
    amountBasisPoints: number;
    productIds: string[];
    providerCustomerId: string;
    expiresAt?: string | null;
    subscriptionCycles: number;
    metadata: Record<string, string | number | boolean>;
    idempotencyKey: string;
  }): Promise<{ providerDiscountId: string; code: string; amountBasisPoints: number; restrictedTo: string[]; subscriptionCycles?: number | null }>;
  attachDiscountCustomer(providerDiscountId: string, providerCustomerId: string): Promise<void>;
};

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

export type CohortBenefitBillingPort = CohortBenefitActivationPort & {
  prepareCheckoutDiscount(input: {
    workspaceId: string;
    billingInterval: BillingInterval;
    productIds: string[];
    providerCustomerId: string;
    now?: string;
    nextBillingAt?: string;
  }): Promise<string | null>;
  preparePlanChangeDiscount(input: {
    workspaceId: string;
    billingInterval: BillingInterval;
    productIds: string[];
    providerCustomerId: string;
    nextBillingAt: string;
    now?: string;
  }): Promise<string[]>;
};

export class CohortBenefitService implements CohortBenefitActivationPort {
  constructor(
    private readonly repository: CohortBenefitRepository = createSupabaseCohortBenefitRepository(),
    private readonly provider?: CohortBenefitProviderPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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

  async prepareCheckoutDiscount(input: {
    workspaceId: string;
    billingInterval: BillingInterval;
    productIds: string[];
    providerCustomerId: string;
    now?: string;
    nextBillingAt?: string;
  }): Promise<string | null> {
    if (!this.provider) return null;
    const benefit = await this.repository.getReadModel(input.workspaceId);
    if (!benefit.benefit || benefit.benefit.status === "revoked" || benefit.benefit.status === "expired") return null;
    const now = input.now ?? this.clock().toISOString();
    const entitlementId = await this.repository.getEntitlementId(input.workspaceId);
    if (!entitlementId) return null;
    if (!input.providerCustomerId.trim()) throw new AppError("CONFLICT", "A trusted Dodo customer is required before applying a cohort benefit.");
    const cycles = benefit.benefit.status === "active" && benefit.benefit.expiresAt
      ? getRemainingEligibleDiscountCycles({
          activatedAt: benefit.benefit.activatedAt ?? now,
          expiresAt: benefit.benefit.expiresAt,
          now,
          nextBillingAt: input.nextBillingAt ?? now,
          billingInterval: input.billingInterval,
        })
      : initialDiscountCycles(benefit.benefit.durationMonths, input.billingInterval);
    if (cycles < 1) return null;
    return this.ensureProviderDiscount({
      workspaceId: input.workspaceId,
      entitlementId,
      policyKey: benefit.benefit.policyKey,
      discountPercent: benefit.benefit.discountPercent,
      expiresAt: benefit.benefit.status === "active" ? benefit.benefit.expiresAt : null,
      billingInterval: input.billingInterval,
      productIds: input.productIds,
      providerCustomerId: input.providerCustomerId,
      cycles,
    });
  }

  async preparePlanChangeDiscount(input: {
    workspaceId: string;
    billingInterval: BillingInterval;
    productIds: string[];
    providerCustomerId: string;
    nextBillingAt: string;
    now?: string;
  }): Promise<string[]> {
    if (!this.provider) return [];
    const benefit = await this.repository.getReadModel(input.workspaceId);
    if (!benefit.benefit || benefit.benefit.status !== "active" || !benefit.benefit.activatedAt || !benefit.benefit.expiresAt) return [];
    const now = input.now ?? this.clock().toISOString();
    const entitlementId = await this.repository.getEntitlementId(input.workspaceId);
    if (!entitlementId) return [];
    if (!input.providerCustomerId.trim()) throw new AppError("CONFLICT", "A trusted Dodo customer is required before applying a cohort benefit.");
    const cycles = getRemainingEligibleDiscountCycles({
      activatedAt: benefit.benefit.activatedAt,
      expiresAt: benefit.benefit.expiresAt,
      now,
      nextBillingAt: input.nextBillingAt,
      billingInterval: input.billingInterval,
    });
    if (cycles < 1) return [];
    const code = await this.ensureProviderDiscount({
      workspaceId: input.workspaceId,
      entitlementId,
      policyKey: benefit.benefit.policyKey,
      discountPercent: benefit.benefit.discountPercent,
      expiresAt: benefit.benefit.expiresAt,
      billingInterval: input.billingInterval,
      productIds: input.productIds,
      providerCustomerId: input.providerCustomerId,
      cycles,
    });
    return [code];
  }

  private async ensureProviderDiscount(input: {
    workspaceId: string;
    entitlementId: string;
    policyKey: string;
    discountPercent: number;
    expiresAt: string | null;
    billingInterval: BillingInterval;
    productIds: string[];
    providerCustomerId: string;
    cycles: number;
  }): Promise<string> {
    const existing = await this.repository.getProviderBinding({
      workspaceId: input.workspaceId,
      entitlementId: input.entitlementId,
      billingInterval: input.billingInterval,
    });
    if (existing && existing.status === "active" && existing.cycleLimit === input.cycles && existing.discountPercent === input.discountPercent && existing.providerCustomerId === input.providerCustomerId) return existing.providerDiscountCode;
    const discount = await this.provider!.createDiscount({
      amountBasisPoints: input.discountPercent * 100,
      productIds: input.productIds,
      providerCustomerId: input.providerCustomerId,
      expiresAt: input.expiresAt,
      subscriptionCycles: input.cycles,
      metadata: {
        wanterest_entitlement_id: input.entitlementId,
        workspace_id: input.workspaceId,
        policy_key: input.policyKey,
        cohort: input.policyKey.startsWith("founding") ? "founding_25" : "early_100",
      },
      idempotencyKey: `wanterest:cohort-benefit:${input.entitlementId}:${input.billingInterval}:${input.cycles}`,
    });
    await this.provider!.attachDiscountCustomer(discount.providerDiscountId, input.providerCustomerId);
    return (await this.repository.upsertProviderBinding({
      workspaceId: input.workspaceId,
      entitlementId: input.entitlementId,
      provider: "dodo",
      providerDiscountId: discount.providerDiscountId,
      providerDiscountCode: discount.code,
      providerCustomerId: input.providerCustomerId,
      billingInterval: input.billingInterval,
      cycleLimit: input.cycles,
      discountPercent: input.discountPercent,
    })).providerDiscountCode;
  }
}

export function createCohortBenefitService(repository?: CohortBenefitRepository, provider?: CohortBenefitProviderPort): CohortBenefitService {
  return new CohortBenefitService(repository, provider);
}

export const getWorkspaceCohortBenefitQuery = cache(async function getWorkspaceCohortBenefitQuery(workspaceId: unknown): Promise<CohortBenefitReadModel> {
  const parsed = z.string().uuid().safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  await requireUser();
  return createSupabaseCohortBenefitRepository(await createSupabaseServerClient()).getReadModel(parsed.data);
});
