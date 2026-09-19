import { z } from "zod";

export const workspaceIdSchema = z.string().uuid();
export const memberIdSchema = z.string().uuid();
export const userIdSchema = z.string().uuid();

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a URL-safe workspace slug."),
});

export const addWorkspaceMemberInputSchema = z.object({
  userId: userIdSchema,
  role: z.enum(["owner", "admin", "member", "viewer"]).default("member"),
});

export const updateWorkspaceMemberInputSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberInputSchema>;
export type UpdateWorkspaceMemberInput = z.infer<typeof updateWorkspaceMemberInputSchema>;
