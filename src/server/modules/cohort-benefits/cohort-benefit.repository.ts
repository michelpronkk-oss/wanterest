import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { cohortBenefitReadModelSchema, type CohortBenefitReadModel } from "./cohort-benefit.schemas";

type Client = SupabaseClient;
type RpcError = { code?: string; message?: string } | null;

function firstRow<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function mapDatabaseError(error: RpcError, fallback: string): AppError {
  if (error?.code === "42501" || error?.message?.includes("access_denied") || error?.message?.includes("service_role_required")) {
    return new AppError("FORBIDDEN", "You are not authorized to access cohort benefits.");
  }
  if (error?.code === "P0002" || error?.message?.includes("not_found") || error?.message?.includes("not_granted")) {
    return new AppError("NOT_FOUND", "The cohort benefit was not found.");
  }
  if (error?.code === "22023") return new AppError("VALIDATION_ERROR", "The cohort benefit request is not valid.", 422);
  return new AppError("INTERNAL_ERROR", fallback, 500, error?.message ? { providerMessage: error.message } : undefined);
}

function parseReadModel(raw: Record<string, unknown> | null): CohortBenefitReadModel {
  if (!raw) throw new AppError("INTERNAL_ERROR", "Cohort benefit read model returned no result.");
  const status = raw.status as "eligible" | "active" | "expired" | "revoked" | null;
  const parsed = cohortBenefitReadModelSchema.safeParse({
    workspaceId: raw.workspace_id,
    membershipId: raw.membership_id,
    cohort: raw.cohort,
    cohortNumber: raw.cohort_number,
    cohortLimit: raw.cohort_limit,
    displayIdentity: raw.display_identity,
    benefit: status ? {
      policyKey: raw.policy_key,
      discountPercent: raw.discount_percent,
      durationMonths: raw.duration_months,
      status,
      grantedAt: raw.granted_at,
      activatedAt: raw.activated_at,
      expiresAt: raw.expires_at,
      activationSubscriptionId: raw.activation_subscription_id,
      externalDiscountReference: raw.external_discount_reference,
      // Dodo's current port has no discount/coupon operation. This explicit
      // state prevents the read model from claiming provider application.
      providerDiscountStatus: raw.external_discount_reference ? "applied" : "unsupported",
    } : null,
  });
  if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Stored cohort benefit state is invalid.");
  return parsed.data;
}

export type CohortBenefitRepository = {
  getReadModel(workspaceId: string): Promise<CohortBenefitReadModel>;
  grant(input: { workspaceId: string; membershipId: string; policyKey: string; discountPercent: number; durationMonths: number; actorUserId?: string | null }): Promise<{ entitlementId: string; status: string; policyKey: string; created: boolean }>;
  activate(input: { workspaceId: string; subscriptionId: string; activatedAt: string; providerEventId: string; actorUserId?: string | null }): Promise<{ entitlementId: string; status: string; activatedAt: string | null; expiresAt: string | null; changed: boolean }>;
  revoke(input: { workspaceId: string; reason: string; actorUserId?: string | null }): Promise<{ entitlementId: string; status: string; changed: boolean }>;
};

export function createSupabaseCohortBenefitRepository(client: Client = createSupabaseServiceClient() as unknown as Client): CohortBenefitRepository {
  return {
    async getReadModel(workspaceId) {
      const { data, error } = await client.rpc("get_workspace_cohort_benefit", { p_workspace_id: workspaceId });
      if (error) throw mapDatabaseError(error, "Cohort benefit read model could not be loaded.");
      return parseReadModel(firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null));
    },
    async grant(input) {
      const { data, error } = await client.rpc("grant_workspace_cohort_benefit", {
        p_workspace_id: input.workspaceId,
        p_cohort_membership_id: input.membershipId,
        p_policy_key: input.policyKey,
        p_discount_percent: input.discountPercent,
        p_duration_months: input.durationMonths,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (error) throw mapDatabaseError(error, "Cohort benefit could not be granted.");
      const row = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!row) throw new AppError("INTERNAL_ERROR", "Cohort benefit grant returned no result.");
      return {
        entitlementId: String(row.entitlement_id),
        status: String(row.status),
        policyKey: String(row.policy_key),
        created: row.created === true,
      };
    },
    async activate(input) {
      const { data, error } = await client.rpc("activate_workspace_cohort_benefit", {
        p_workspace_id: input.workspaceId,
        p_activation_subscription_id: input.subscriptionId,
        p_activated_at: input.activatedAt,
        p_provider_event_id: input.providerEventId,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (error) throw mapDatabaseError(error, "Cohort benefit could not be activated.");
      const row = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!row) throw new AppError("INTERNAL_ERROR", "Cohort benefit activation returned no result.");
      return {
        entitlementId: String(row.entitlement_id),
        status: String(row.activation_status),
        activatedAt: typeof row.activated_at === "string" ? row.activated_at : null,
        expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
        changed: row.changed === true,
      };
    },
    async revoke(input) {
      const { data, error } = await client.rpc("revoke_workspace_cohort_benefit", {
        p_workspace_id: input.workspaceId,
        p_reason: input.reason,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (error) throw mapDatabaseError(error, "Cohort benefit could not be revoked.");
      const row = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!row) throw new AppError("INTERNAL_ERROR", "Cohort benefit revocation returned no result.");
      return { entitlementId: String(row.entitlement_id), status: String(row.revocation_status), changed: row.changed === true };
    },
  };
}
