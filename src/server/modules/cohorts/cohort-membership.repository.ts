import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/server/lib/errors";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import {
  cohortAssignmentSchema,
  workspaceCohortIdentitySchema,
  type CohortAssignment,
  type CohortAssignmentInput,
  type WorkspaceCohortIdentity,
} from "./cohort-membership.schemas";

type Client = SupabaseClient;

type RpcError = { code?: string; message?: string } | null;

function mapDatabaseError(error: RpcError, fallback: string): AppError {
  const message = error?.message ?? "";
  if (error?.code === "42501" || message.includes("_access_denied") || message.includes("service_role_required")) {
    return new AppError("FORBIDDEN", "You are not authorized to access workspace cohort identity.");
  }
  if (error?.code === "P0002" || message.includes("_not_found")) {
    return new AppError("NOT_FOUND", "The workspace was not found.");
  }
  if (error?.code === "23505" || message.includes("_conflict") || message.includes("_already_assigned")) {
    return new AppError("CONFLICT", "The workspace cohort identity conflicts with existing provenance.");
  }
  if (error?.code === "22023") {
    return new AppError("VALIDATION_ERROR", "The workspace cohort assignment is not valid.");
  }
  return new AppError("INTERNAL_ERROR", fallback, 500, error?.message ? { providerMessage: error.message } : undefined);
}

function serviceClient(): Client {
  return createSupabaseServiceClient() as unknown as Client;
}

function firstRow<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

export type CohortMembershipRepository = {
  assignAtAdmission(input: CohortAssignmentInput): Promise<CohortAssignment>;
  /** Production uses the atomic 13A.2B wrapper; fixtures may omit it. */
  assignAtAdmissionWithBenefit?(input: CohortAssignmentInput): Promise<CohortAssignment>;
  getWorkspaceIdentity(workspaceId: string): Promise<WorkspaceCohortIdentity>;
};

export function createSupabaseCohortMembershipRepository(client: Client = serviceClient()): CohortMembershipRepository {
  return {
    async assignAtAdmission(input) {
      const { data, error } = await client.rpc("assign_workspace_cohort_membership", {
        p_workspace_id: input.workspaceId,
        p_source_waitlist_application_id: input.sourceWaitlistApplicationId ?? null,
        p_admission_principal_user_id: input.admissionPrincipalUserId ?? null,
        p_assignment_reason: input.assignmentReason,
        p_assignment_version: input.assignmentVersion,
      });
      if (error) throw mapDatabaseError(error, "Workspace cohort identity could not be assigned.");
      const raw = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!raw) throw new AppError("INTERNAL_ERROR", "Workspace cohort assignment returned no result.");
      const parsed = cohortAssignmentSchema.safeParse({
        assignmentStatus: raw.assignment_status,
        membershipId: raw.membership_id,
        workspaceId: raw.workspace_id,
        cohort: raw.cohort,
        number: raw.cohort_number,
        assignedAt: raw.assigned_at,
        sourceWaitlistApplicationId: raw.source_waitlist_application_id,
        admissionPrincipalUserId: raw.admission_principal_user_id,
        assignmentReason: raw.assignment_reason,
        assignmentVersion: raw.assignment_version,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Stored workspace cohort assignment is invalid.");
      return parsed.data;
    },

    async assignAtAdmissionWithBenefit(input) {
      const { data, error } = await client.rpc("assign_workspace_cohort_membership_with_benefit", {
        p_workspace_id: input.workspaceId,
        p_source_waitlist_application_id: input.sourceWaitlistApplicationId ?? null,
        p_admission_principal_user_id: input.admissionPrincipalUserId ?? null,
        p_assignment_reason: input.assignmentReason,
        p_assignment_version: input.assignmentVersion,
      });
      if (error) throw mapDatabaseError(error, "Workspace cohort identity and benefit eligibility could not be assigned.");
      const raw = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!raw) throw new AppError("INTERNAL_ERROR", "Workspace cohort assignment returned no result.");
      const parsed = cohortAssignmentSchema.safeParse({
        assignmentStatus: raw.assignment_status,
        membershipId: raw.membership_id,
        workspaceId: raw.workspace_id,
        cohort: raw.cohort,
        number: raw.cohort_number,
        assignedAt: raw.assigned_at,
        sourceWaitlistApplicationId: raw.source_waitlist_application_id,
        admissionPrincipalUserId: raw.admission_principal_user_id,
        assignmentReason: raw.assignment_reason,
        assignmentVersion: raw.assignment_version,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Stored workspace cohort assignment is invalid.");
      return parsed.data;
    },

    async getWorkspaceIdentity(workspaceId) {
      const { data, error } = await client.rpc("get_workspace_cohort_identity", { p_workspace_id: workspaceId });
      if (error) throw mapDatabaseError(error, "Workspace cohort identity could not be loaded.");
      const raw = firstRow(data as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
      if (!raw) throw new AppError("NOT_FOUND", "The workspace was not found.");
      const parsed = workspaceCohortIdentitySchema.safeParse({
        cohort: raw.cohort,
        number: raw.cohort_number,
        limit: raw.cohort_limit,
        displayIdentity: raw.display_identity,
        assignedAt: raw.assigned_at,
        workspaceStatus: raw.workspace_status,
        benefitPolicyKey: null,
      });
      if (!parsed.success) throw new AppError("INTERNAL_ERROR", "Stored workspace cohort identity is invalid.");
      return parsed.data;
    },
  };
}
