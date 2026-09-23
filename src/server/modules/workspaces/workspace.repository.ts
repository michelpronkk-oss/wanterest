import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import type {
  WorkspaceMemberRole,
  WorkspaceMemberRow,
  WorkspaceRow,
} from "@/server/db/database.helpers";
import { AppError } from "@/server/lib/errors";

type Client = SupabaseClient<Database>;
export type WorkspaceContextRow = Pick<WorkspaceRow, "id" | "name" | "slug" | "status">;

function databaseError(error: { code?: string; message: string }, message: string): AppError {
  if (error.code === "42501" || error.message.includes("_denied")) {
    return new AppError("FORBIDDEN", "You are not authorized to perform this workspace operation.");
  }
  if (error.code === "23505" || error.message.includes("already_exists")) {
    return new AppError("CONFLICT", "That workspace or membership already exists.");
  }
  if (error.code === "P0002" || error.message.includes("_not_found")) {
    return new AppError("NOT_FOUND", message);
  }
  if (error.code === "22003" && error.message.includes("seat_limit_exceeded")) {
    return new AppError("USAGE_LIMIT_EXCEEDED", "The workspace seat limit was reached.");
  }
  if (error.code === "22023") {
    return new AppError("VALIDATION_ERROR", "The workspace operation is not valid.");
  }
  return new AppError("INTERNAL_ERROR", message, 500, { providerMessage: error.message });
}

function requireData<T>(
  data: T | null,
  error: { code?: string; message: string } | null,
  message: string,
): T {
  if (error) {
    throw databaseError(error, message);
  }
  if (!data) throw new AppError("NOT_FOUND", message);
  return data;
}

export async function createWorkspace(
  client: Client,
  input: { name: string; slug: string; traceId: string },
): Promise<WorkspaceRow> {
  const { data, error } = await client.rpc("create_workspace", {
    p_name: input.name,
    p_slug: input.slug,
    p_trace_id: input.traceId,
  });
  return requireData(data, error, "Workspace could not be created.");
}

export async function listWorkspaces(client: Client): Promise<WorkspaceRow[]> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, name, slug, status, created_by, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Workspaces could not be loaded.", 500, {
      providerMessage: error.message,
    });
  }
  return data ?? [];
}

export async function listDashboardWorkspaces(client: Client): Promise<WorkspaceContextRow[]> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, name, slug, status")
    .order("created_at", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Workspaces could not be loaded.", 500, {
      providerMessage: error.message,
    });
  }
  return data ?? [];
}

export async function getWorkspace(client: Client, workspaceId: string): Promise<WorkspaceRow> {
  const { data, error } = await client
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .maybeSingle();
  return requireData(data, error, "Workspace was not found.");
}

export async function listWorkspaceMembers(client: Client, workspaceId: string): Promise<WorkspaceMemberRow[]> {
  const { data, error } = await client
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Workspace members could not be loaded.", 500, {
      providerMessage: error.message,
    });
  }
  return data ?? [];
}

export async function addWorkspaceMember(
  client: Client,
  input: { workspaceId: string; userId: string; role: WorkspaceMemberRole; traceId: string },
): Promise<WorkspaceMemberRow> {
  const { data, error } = await client.rpc("add_workspace_member", {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_role: input.role,
    p_trace_id: input.traceId,
  });
  return requireData(data, error, "Workspace member could not be added.");
}

export async function updateWorkspaceMember(
  client: Client,
  input: { workspaceId: string; memberId: string; role: WorkspaceMemberRole; traceId: string },
): Promise<WorkspaceMemberRow> {
  const { data, error } = await client.rpc("update_workspace_member", {
    p_workspace_id: input.workspaceId,
    p_member_id: input.memberId,
    p_role: input.role,
    p_trace_id: input.traceId,
  });
  return requireData(data, error, "Workspace member could not be updated.");
}

export async function deactivateWorkspaceMember(
  client: Client,
  input: { workspaceId: string; memberId: string; traceId: string },
): Promise<WorkspaceMemberRow> {
  const { data, error } = await client.rpc("deactivate_workspace_member", {
    p_workspace_id: input.workspaceId,
    p_member_id: input.memberId,
    p_trace_id: input.traceId,
  });
  return requireData(data, error, "Workspace member could not be deactivated.");
}
