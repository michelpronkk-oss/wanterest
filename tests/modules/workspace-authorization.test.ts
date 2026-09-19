import { describe, expect, it } from "vitest";

import {
  addWorkspaceMemberInputSchema,
  updateWorkspaceMemberInputSchema,
} from "../../src/server/modules/workspaces/workspace.schemas";

describe("workspace authorization contracts", () => {
  it("accepts only the four approved roles", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(updateWorkspaceMemberInputSchema.safeParse({ role }).success).toBe(true);
    }
    expect(updateWorkspaceMemberInputSchema.safeParse({ role: "billing" }).success).toBe(false);
  });

  it("requires a UUID for membership targets", () => {
    expect(
      addWorkspaceMemberInputSchema.safeParse({
        userId: "11111111-1111-4111-8111-111111111111",
        role: "member",
      }).success,
    ).toBe(true);
    expect(addWorkspaceMemberInputSchema.safeParse({ userId: "not-a-uuid" }).success).toBe(false);
  });
});
