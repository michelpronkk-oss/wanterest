import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CohortMembershipService } from "../../src/server/modules/cohorts/cohort-membership.service";
import type { CohortMembershipRepository } from "../../src/server/modules/cohorts/cohort-membership.repository";

const workspaceId = "10000000-0000-4000-8000-000000000001";

function repository(): CohortMembershipRepository & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async assignAtAdmission(input) {
      calls.push(input);
      return {
        assignmentStatus: "assigned",
        membershipId: "20000000-0000-4000-8000-000000000001",
        workspaceId: input.workspaceId,
        cohort: "founding_25",
        number: 1,
        assignedAt: "2026-09-27T20:00:00.000Z",
        sourceWaitlistApplicationId: input.sourceWaitlistApplicationId ?? null,
        admissionPrincipalUserId: input.admissionPrincipalUserId ?? null,
        assignmentReason: input.assignmentReason,
        assignmentVersion: input.assignmentVersion,
      };
    },
    async getWorkspaceIdentity() {
      return {
        cohort: "founding_25",
        number: 1,
        limit: 25,
        displayIdentity: "Founding 25",
        assignedAt: "2026-09-27T20:00:00.000Z",
        workspaceStatus: "active",
        benefitPolicyKey: null,
      };
    },
  };
}

describe("cohort membership service", () => {
  it("accepts only the controlled admission input and never accepts a requested number", async () => {
    const repo = repository();
    const service = new CohortMembershipService(repo);
    await expect(service.assignAtAdmission({ workspaceId, cohort: "founding_25", cohortNumber: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.assignAtAdmission({ workspaceId, assignmentReason: "admission" })).resolves.toMatchObject({ assignmentStatus: "assigned", number: 1 });
    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]).toEqual({ workspaceId, assignmentReason: "admission", assignmentVersion: "workspace_cohort_membership_v1" });
  });

  it("preserves separate namespaces and the future benefit seam", async () => {
    const repo = repository();
    const identity = await repo.getWorkspaceIdentity(workspaceId);
    expect(identity).toEqual({
      cohort: "founding_25",
      number: 1,
      limit: 25,
      displayIdentity: "Founding 25",
      assignedAt: "2026-09-27T20:00:00.000Z",
      workspaceStatus: "active",
      benefitPolicyKey: null,
    });
    expect(identity).not.toHaveProperty("earlyAccessNumber");
  });
});
