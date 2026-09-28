import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { openAdmissionResultSchema, type OpenAdmissionResult } from "./open-admission.schemas";

type OpenAdmissionClient = SupabaseClient;

function mapDatabaseError(error: { code?: string; message?: string }): AppError {
  const message = error.message ?? "";
  if (error.code === "42501" || message.includes("public_signup_not_allowed") || message.includes("email_not_verified")) {
    return new AppError("FORBIDDEN", "Public signup is not available for this account in the current access mode.");
  }
  if (error.code === "23505" || message.includes("already_admitted")) {
    return new AppError("CONFLICT", "This account already has product access.");
  }
  if (error.code === "22023") return new AppError("VALIDATION_ERROR", "The workspace admission is not valid.");
  return new AppError("INTERNAL_ERROR", "Open signup could not be completed.", 500, { providerMessage: message });
}
export type OpenAdmissionRepository = {
  provision(input: { userId: string; name: string; slug: string; traceId: string }): Promise<OpenAdmissionResult>;
};

export function createSupabaseOpenAdmissionRepository(client: OpenAdmissionClient = createSupabaseServiceClient()): OpenAdmissionRepository {
  return {
    async provision(input) {
      const { data, error } = await client.rpc("provision_workspace_admission", {
        p_user_id: input.userId,
        p_source: "open_signup",
        p_workspace_name: input.name,
        p_workspace_slug: input.slug,
        p_idempotency_key: `open-signup:${input.userId}`,
        p_waitlist_application_id: null,
        p_invite_id: null,
        p_trace_id: input.traceId,
      });
      if (error) throw mapDatabaseError(error);
      const raw = Array.isArray(data) ? data[0] : data;
      const parsed = openAdmissionResultSchema.safeParse({
        admissionId: raw?.admission_id,
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
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Open signup admission response is invalid.");
      return parsed.data;
    },
  };
}
