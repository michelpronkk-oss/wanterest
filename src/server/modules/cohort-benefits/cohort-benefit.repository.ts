import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { cohortBenefitReadModelSchema, type CohortBenefitReadModel } from "./cohort-benefit.schemas";
import type { BillingInterval } from "../billing/billing.schemas";

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
      providerDiscountStatus: raw.external_discount_reference ? "applied" : "not_required",
    } : null,
  });
  if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Stored cohort benefit state is invalid.");
  return parsed.data;
}

export type CohortBenefitRepository = {
  getReadModel(workspaceId: string): Promise<CohortBenefitReadModel>;
  getEntitlementId(workspaceId: string): Promise<string | null>;
  grant(input: { workspaceId: string; membershipId: string; policyKey: string; discountPercent: number; durationMonths: number; actorUserId?: string | null }): Promise<{ entitlementId: string; status: string; policyKey: string; created: boolean }>;
  activate(input: { workspaceId: string; subscriptionId: string; activatedAt: string; providerEventId: string; actorUserId?: string | null }): Promise<{ entitlementId: string; status: string; activatedAt: string | null; expiresAt: string | null; changed: boolean }>;
  revoke(input: { workspaceId: string; reason: string; actorUserId?: string | null }): Promise<{ entitlementId: string; status: string; changed: boolean }>;
  getProviderBinding(input: { workspaceId: string; entitlementId: string; billingInterval: BillingInterval }): Promise<CohortBenefitProviderBinding | null>;
  upsertProviderBinding(input: UpsertCohortBenefitProviderBindingInput): Promise<CohortBenefitProviderBinding>;
};

export type CohortBenefitProviderBinding = {
  id: string;
  workspaceId: string;
  entitlementId: string;
  provider: "dodo";
  providerDiscountId: string;
  providerDiscountCode: string;
  billingInterval: BillingInterval;
  cycleLimit: number;
  discountPercent: number;
  status: "active" | "superseded" | "expired" | "revoked";
  createdAt: string;
  supersededAt: string | null;
  lastSyncedAt: string;
};

export type UpsertCohortBenefitProviderBindingInput = Omit<CohortBenefitProviderBinding, "id" | "createdAt" | "supersededAt" | "lastSyncedAt" | "status">;

export function createSupabaseCohortBenefitRepository(client: Client = createSupabaseServiceClient() as unknown as Client): CohortBenefitRepository {
  return {
    async getReadModel(workspaceId) {
      const { data, error } = await client.rpc("get_workspace_cohort_benefit", { p_workspace_id: workspaceId });
      if (error) throw mapDatabaseError(error, "Cohort benefit read model could not be loaded.");
      return parseReadModel(firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null));
    },
    async getEntitlementId(workspaceId) {
      const response = await client.from("workspace_cohort_benefit_entitlements").select("id").eq("workspace_id", workspaceId).maybeSingle();
      if (response.error) throw mapDatabaseError(response.error, "Cohort benefit entitlement could not be loaded.");
      return typeof response.data?.id === "string" ? response.data.id : null;
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
    async getProviderBinding(input) {
      const response = await client.from("workspace_cohort_benefit_provider_bindings")
        .select("*")
        .eq("workspace_id", input.workspaceId)
        .eq("entitlement_id", input.entitlementId)
        .eq("billing_interval", input.billingInterval)
        .eq("status", "active")
        .maybeSingle();
      if (response.error) throw mapDatabaseError(response.error, "Cohort benefit provider binding could not be loaded.");
      if (!response.data) return null;
      return mapProviderBinding(response.data as Record<string, unknown>);
    },
    async upsertProviderBinding(input) {
      const { data, error } = await client.rpc("upsert_workspace_cohort_benefit_provider_binding", {
        p_workspace_id: input.workspaceId,
        p_entitlement_id: input.entitlementId,
        p_provider: input.provider,
        p_provider_discount_id: input.providerDiscountId,
        p_provider_discount_code: input.providerDiscountCode,
        p_billing_interval: input.billingInterval,
        p_cycle_limit: input.cycleLimit,
        p_discount_percent: input.discountPercent,
      });
      if (error) throw mapDatabaseError(error, "Cohort benefit provider binding could not be saved.");
      const row = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!row) throw new AppError("INTERNAL_ERROR", "Cohort benefit provider binding returned no result.");
      const saved = await client.from("workspace_cohort_benefit_provider_bindings").select("*").eq("id", String(row.binding_id)).single();
      if (saved.error || !saved.data) throw mapDatabaseError(saved.error, "Cohort benefit provider binding could not be reloaded.");
      return mapProviderBinding(saved.data as Record<string, unknown>);
    },
  };
}

function mapProviderBinding(raw: Record<string, unknown>): CohortBenefitProviderBinding {
  const billingInterval = raw.billing_interval === "annual" ? "annual" : raw.billing_interval === "monthly" ? "monthly" : null;
  const status = raw.status === "active" || raw.status === "superseded" || raw.status === "expired" || raw.status === "revoked" ? raw.status : null;
  if (!billingInterval || !status || typeof raw.id !== "string" || typeof raw.workspace_id !== "string" || typeof raw.entitlement_id !== "string" || raw.provider !== "dodo" || typeof raw.provider_discount_id !== "string" || typeof raw.provider_discount_code !== "string" || typeof raw.cycle_limit !== "number" || typeof raw.discount_percent !== "number" || typeof raw.created_at !== "string" || typeof raw.last_synced_at !== "string") {
    throw new AppError("INTERNAL_ERROR", "Stored cohort benefit provider binding is invalid.");
  }
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    entitlementId: raw.entitlement_id,
    provider: "dodo",
    providerDiscountId: raw.provider_discount_id,
    providerDiscountCode: raw.provider_discount_code,
    billingInterval,
    cycleLimit: raw.cycle_limit,
    discountPercent: raw.discount_percent,
    status,
    createdAt: raw.created_at,
    supersededAt: typeof raw.superseded_at === "string" ? raw.superseded_at : null,
    lastSyncedAt: raw.last_synced_at,
  };
}
