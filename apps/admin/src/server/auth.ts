import "server-only";

import { redirect } from "next/navigation";
import { createAdminServiceClient, createAdminSessionClient } from "./supabase";

const roleLabels = {
  founder: "Founder",
  operations_admin: "Operations Admin",
  support: "Support",
  read_only_analyst: "Read-only Analyst",
} as const;

export type AdminRole = keyof typeof roleLabels;

export type AdminContext = {
  userId: string;
  role: AdminRole;
  roleLabel: string;
  initials: string;
};

export function adminCan(context: AdminContext, permission: string): boolean {
  return rolePermissions[context.role].has(permission);
}

const rolePermissions: Record<AdminRole, ReadonlySet<string>> = {
  founder: new Set(["operations.read", "operations.summary.read", "analytics.read", "lifecycle.read", "billing.read"]),
  operations_admin: new Set(["operations.read", "operations.summary.read", "analytics.read", "lifecycle.read", "billing.read"]),
  support: new Set(["analytics.read", "lifecycle.read"]),
  read_only_analyst: new Set(["operations.summary.read", "analytics.read", "lifecycle.read", "billing.read"]),
};

export async function getAdminContext(): Promise<AdminContext | null> {
  const session = await createAdminSessionClient();
  if (!session) return null;

  const { data: userData, error: userError } = await session.auth.getUser();
  if (userError || !userData.user) return null;

  const service = createAdminServiceClient();
  if (!service) return null;
  const { data: membership, error: membershipError } = await service
    .from("admin_memberships")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership || !Object.hasOwn(roleLabels, membership.role)) return null;

  const { data: assurance, error: assuranceError } = await session.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance.currentLevel !== "aal2") redirect("/mfa-required");

  const role = membership.role as AdminRole;
  return {
    userId: userData.user.id,
    role,
    roleLabel: roleLabels[role],
    initials: roleLabels[role].split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
  };
}

export async function requireAdminContext(): Promise<AdminContext> {
  const context = await getAdminContext();
  if (!context) redirect("/login");
  return context;
}

export async function requireAdminPermission(permission: string): Promise<AdminContext> {
  const context = await requireAdminContext();
  if (!adminCan(context, permission)) redirect("/forbidden");
  return context;
}
