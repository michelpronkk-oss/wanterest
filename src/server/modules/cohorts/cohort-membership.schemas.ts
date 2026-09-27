import { z } from "zod";

export const cohortNames = ["founding_25", "early_100"] as const;
export type CohortName = (typeof cohortNames)[number];

export const cohortAssignmentInputSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceWaitlistApplicationId: z.string().uuid().nullable().optional(),
  admissionPrincipalUserId: z.string().uuid().nullable().optional(),
  assignmentReason: z.string().trim().min(1).max(120).default("admission"),
  assignmentVersion: z.string().trim().min(1).max(120).default("workspace_cohort_membership_v1"),
}).strict();

export type CohortAssignmentInput = z.infer<typeof cohortAssignmentInputSchema>;

export const cohortAssignmentStatuses = ["assigned", "existing", "no_special_cohort"] as const;
export type CohortAssignmentStatus = (typeof cohortAssignmentStatuses)[number];

export const cohortAssignmentSchema = z.object({
  assignmentStatus: z.enum(cohortAssignmentStatuses),
  membershipId: z.string().uuid().nullable(),
  workspaceId: z.string().uuid(),
  cohort: z.enum(cohortNames).nullable(),
  number: z.number().int().positive().nullable(),
  assignedAt: z.string().datetime({ offset: true }).nullable(),
  sourceWaitlistApplicationId: z.string().uuid().nullable(),
  admissionPrincipalUserId: z.string().uuid().nullable(),
  assignmentReason: z.string(),
  assignmentVersion: z.string(),
}).superRefine((value, context) => {
  if (value.assignmentStatus === "no_special_cohort") {
    if (value.membershipId !== null || value.cohort !== null || value.number !== null || value.assignedAt !== null) {
      context.addIssue({ code: "custom", message: "No-special-cohort results cannot contain an assigned identity." });
    }
    return;
  }
  if (value.membershipId === null || value.cohort === null || value.number === null || value.assignedAt === null) {
    context.addIssue({ code: "custom", message: "Assigned cohort results must contain the immutable identity." });
  }
});

export type CohortAssignment = z.infer<typeof cohortAssignmentSchema>;

export const workspaceCohortIdentitySchema = z.object({
  cohort: z.enum(["founding_25", "early_100", "none"]),
  number: z.number().int().positive().nullable(),
  limit: z.union([z.literal(25), z.literal(100)]).nullable(),
  displayIdentity: z.enum(["Founding 25", "Early 100"]).nullable(),
  assignedAt: z.string().datetime({ offset: true }).nullable(),
  workspaceStatus: z.enum(["active", "suspended", "archived"]),
  benefitPolicyKey: z.null(),
});

export type WorkspaceCohortIdentity = z.infer<typeof workspaceCohortIdentitySchema>;
