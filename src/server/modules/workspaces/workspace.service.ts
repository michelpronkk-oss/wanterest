import { cookies } from "next/headers";
import { cache } from "react";

import { requireUser } from "@/server/modules/auth";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { AppError } from "@/server/lib/errors";
import { getTraceId } from "@/server/lib/request-context";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import {
  addWorkspaceMember,
  createWorkspace,
  deactivateWorkspaceMember,
  getWorkspace,
  listWorkspaceMembers,
  listDashboardWorkspaces,
  listWorkspaces,
  updateWorkspaceMember,
} from "./workspace.repository";
import {
  addWorkspaceMemberInputSchema,
  createWorkspaceInputSchema,
  memberIdSchema,
  updateWorkspaceMemberInputSchema,
  workspaceIdSchema,
} from "./workspace.schemas";

const ACTIVE_WORKSPACE_COOKIE = "wanterest_active_workspace";

export async function createWorkspaceCommand(input: unknown, request?: Request) {
  const parsed = createWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid workspace input.", 422, {
      issues: parsed.error.issues,
    });
  }

  await requireUser();
  const client = await createSupabaseServerClient();
  return createWorkspace(client, { ...parsed.data, traceId: getTraceId(request) });
}

export const listWorkspacesQuery = cache(async function listWorkspacesQuery() {
  await requireUser();
  return listWorkspaces(await createSupabaseServerClient());
});

export const listDashboardWorkspacesQuery = cache(async function listDashboardWorkspacesQuery() {
  await requireUser();
  return listDashboardWorkspaces(await createSupabaseServerClient());
});

export const getWorkspaceQuery = cache(async function getWorkspaceQuery(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  await requireUser();
  return getWorkspace(await createSupabaseServerClient(), parsed.data);
});

export async function selectWorkspaceCommand(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  await requireUser();
  const workspace = await getWorkspace(await createSupabaseServerClient(), parsed.data);
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return workspace;
}

export async function resolveWorkspaceQuery(requestedWorkspaceId?: unknown) {
  if (requestedWorkspaceId !== undefined) return getWorkspaceQuery(requestedWorkspaceId);

  const cookieStore = await cookies();
  const selected = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (selected) {
    return getWorkspaceQuery(selected);
  }

  const workspaces = await listWorkspacesQuery();
  const workspace = workspaces[0];
  if (!workspace) throw new AppError("NOT_FOUND", "No workspace is available.");
  return workspace;
}

export async function addWorkspaceMemberCommand(
  workspaceId: unknown,
  input: unknown,
  request?: Request,
) {
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  const parsed = addWorkspaceMemberInputSchema.safeParse(input);
  if (!parsedWorkspaceId.success || !parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid membership input.");
  }
  await requireUser();
  return addWorkspaceMember(await createSupabaseServerClient(), {
    workspaceId: parsedWorkspaceId.data,
    userId: parsed.data.userId,
    role: parsed.data.role,
    traceId: getTraceId(request),
  });
}

export async function updateWorkspaceMemberCommand(
  workspaceId: unknown,
  memberId: unknown,
  input: unknown,
  request?: Request,
) {
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  const parsedMemberId = memberIdSchema.safeParse(memberId);
  const parsed = updateWorkspaceMemberInputSchema.safeParse(input);
  if (!parsedWorkspaceId.success || !parsedMemberId.success || !parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid membership input.");
  }
  await requireUser();
  return updateWorkspaceMember(await createSupabaseServerClient(), {
    workspaceId: parsedWorkspaceId.data,
    memberId: parsedMemberId.data,
    role: parsed.data.role,
    traceId: getTraceId(request),
  });
}

export async function deactivateWorkspaceMemberCommand(
  workspaceId: unknown,
  memberId: unknown,
  request?: Request,
) {
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  const parsedMemberId = memberIdSchema.safeParse(memberId);
  if (!parsedWorkspaceId.success || !parsedMemberId.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid membership input.");
  }
  await requireUser();
  return deactivateWorkspaceMember(await createSupabaseServerClient(), {
    workspaceId: parsedWorkspaceId.data,
    memberId: parsedMemberId.data,
    traceId: getTraceId(request),
  });
}

/** Thin read wrapper: lists workspace_members and best-effort resolves each member's email via the service-role admin API. No role/permission logic beyond the existing RLS on workspace_members. */
export async function listWorkspaceMembersQuery(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  await requireUser();
  const members = await listWorkspaceMembers(await createSupabaseServerClient(), parsed.data);
  const serviceClient = createSupabaseServiceClient();
  return Promise.all(
    members.map(async (member) => {
      let email: string | null = null;
      try {
        const { data } = await serviceClient.auth.admin.getUserById(member.user_id);
        email = data.user?.email ?? null;
      } catch {
        email = null;
      }
      return { ...member, email };
    }),
  );
}

export { ACTIVE_WORKSPACE_COOKIE };
