import "server-only";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import {
  admissionInviteSchema,
  admissionResultSchema,
  waitlistAdmissionStatusSchema,
  type AdmissionInvite,
  type AdmissionResult,
  type WaitlistAdmissionStatus,
} from "./waitlist-admission.schemas";

type RpcError = { code?: string; message?: string } | null;
type Client = { rpc(functionName: string, args: Record<string, unknown>): Promise<{ data: unknown; error: RpcError }> };

function firstRow<T>(data: T | T[] | null): T | null { return Array.isArray(data) ? data[0] ?? null : data; }

function mapDatabaseError(error: RpcError, fallback: string): AppError {
  const message = error?.message ?? "";
  if (error?.code === "42501" || message.includes("service_role_required") || message.includes("email_mismatch")) {
    return new AppError("FORBIDDEN", message.includes("email_mismatch") ? "This invite belongs to a different account." : "You are not authorized to use this invite.");
  }
  if (error?.code === "P0002" || message.includes("not_found")) return new AppError("NOT_FOUND", fallback);
  if (error?.code === "23505" && message.includes("already_admitted")) return new AppError("CONFLICT", "This waitlist application is already admitted.");
  if (error?.code === "22023" || message.includes("unusable") || message.includes("expired")) return new AppError("CONFLICT", "This invite is no longer usable.");
  return new AppError("INTERNAL_ERROR", fallback, 500, error?.message ? { providerMessage: error.message } : undefined);
}

export type WaitlistAdmissionRepository = {
  issue(input: { applicationId: string; tokenHash: string; actorUserId?: string | null }): Promise<AdmissionInvite>;
  revoke(input: { inviteId: string; actorUserId?: string | null; reason?: string }): Promise<{ inviteId: string; status: string; changed: boolean }>;
  getStatus(statusTokenHash: string): Promise<WaitlistAdmissionStatus>;
  accept(input: { tokenHash: string; userId: string; traceId?: string | null }): Promise<AdmissionResult>;
};

function client(): Client { return createSupabaseServiceClient() as unknown as Client; }

export function createSupabaseWaitlistAdmissionRepository(supabase: Client = client()): WaitlistAdmissionRepository {
  return {
    async issue(input) {
      const response = await supabase.rpc("issue_waitlist_admission_invite", {
        p_waitlist_application_id: input.applicationId,
        p_token_hash: input.tokenHash,
        p_actor_user_id: input.actorUserId ?? null,
      });
      if (response.error) throw mapDatabaseError(response.error, "The admission invite could not be issued.");
      const raw = firstRow(response.data as Record<string, unknown>[] | Record<string, unknown> | null);
      const parsed = admissionInviteSchema.safeParse({
        inviteId: raw?.invite_id,
        waitlistApplicationId: raw?.waitlist_application_id,
        recipientEmail: raw?.recipient_email,
        firstName: raw?.first_name,
        companyName: raw?.company_name,
        status: raw?.status,
        issuedAt: raw?.issued_at,
        expiresAt: raw?.expires_at,
        reissued: raw?.reissued === true,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The admission invite response is invalid.");
      return parsed.data;
    },

    async revoke(input) {
      const response = await supabase.rpc("revoke_waitlist_admission_invite", {
        p_invite_id: input.inviteId,
        p_actor_user_id: input.actorUserId ?? null,
        p_reason: input.reason ?? "revoked_by_internal_operator",
      });
      if (response.error) throw mapDatabaseError(response.error, "The admission invite could not be revoked.");
      const raw = firstRow(response.data as Record<string, unknown>[] | Record<string, unknown> | null);
      if (!raw || typeof raw.invite_id !== "string" || typeof raw.status !== "string") throw new AppError("INTERNAL_ERROR", "The admission invite revocation response is invalid.");
      return { inviteId: raw.invite_id, status: raw.status, changed: raw.changed === true };
    },

    async getStatus(statusTokenHash) {
      const response = await supabase.rpc("get_waitlist_admission_status_by_token", { p_status_token_hash: statusTokenHash });
      if (response.error) throw mapDatabaseError(response.error, "The private admission status could not be loaded.");
      const raw = firstRow(response.data as Record<string, unknown>[] | Record<string, unknown> | null);
      const parsed = waitlistAdmissionStatusSchema.safeParse({
        applicationStatus: raw?.application_status,
        inviteStatus: raw?.invite_status ?? null,
        inviteExpiresAt: raw?.invite_expires_at ?? null,
        admissionStatus: raw?.admission_status,
        admissionId: raw?.admission_id ?? null,
        workspaceId: raw?.workspace_id ?? null,
        cohort: raw?.cohort ?? null,
        cohortNumber: raw?.cohort_number ?? null,
        cohortLimit: raw?.cohort_limit ?? null,
        displayIdentity: raw?.display_identity ?? null,
        benefitPolicyKey: raw?.benefit_policy_key ?? null,
        benefitDiscountPercent: raw?.benefit_discount_percent ?? null,
        benefitDurationMonths: raw?.benefit_duration_months ?? null,
        benefitStatus: raw?.benefit_status ?? null,
        onboardingStatus: raw?.onboarding_status ?? null,
        admittedAt: raw?.admitted_at ?? null,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The stored admission status is invalid.");
      return parsed.data;
    },

    async accept(input) {
      const response = await supabase.rpc("accept_waitlist_admission_invite", {
        p_token_hash: input.tokenHash,
        p_user_id: input.userId,
        p_trace_id: input.traceId ?? null,
      });
      if (response.error) throw mapDatabaseError(response.error, "The invite could not be accepted.");
      const raw = firstRow(response.data as Record<string, unknown>[] | Record<string, unknown> | null);
      const parsed = admissionResultSchema.safeParse({
        admissionId: raw?.admission_id,
        inviteId: raw?.invite_id,
        waitlistApplicationId: raw?.waitlist_application_id,
        userId: raw?.user_id,
        workspaceId: raw?.workspace_id,
        cohort: raw?.cohort ?? null,
        cohortNumber: raw?.cohort_number ?? null,
        cohortLimit: raw?.cohort_limit ?? null,
        benefitPolicyKey: raw?.benefit_policy_key ?? null,
        benefitStatus: raw?.benefit_status ?? null,
        profileInitialized: raw?.profile_initialized === true,
        onboardingStatus: raw?.onboarding_status,
        admittedAt: raw?.admitted_at,
        idempotent: raw?.idempotent === true,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "The admission response is invalid.");
      return parsed.data;
    },
  };
}
