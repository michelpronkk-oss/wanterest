import "server-only";

import { createAdminServiceClient } from "./supabase";

export type Metric = { key: string; label: string; value: number | null; source: string; range: string; refreshedAt: string | null; state: "available" | "unavailable" };

const period = "Trailing 7 days (UTC)";

export async function getOverviewMetrics(now = new Date()): Promise<{ checkedAt: string | null; metrics: Metric[] }> {
  const client = createAdminServiceClient();
  const checkedAt = now.toISOString();
  const unavailable = (key: string, label: string, source: string, range = period): Metric => ({ key, label, value: null, source, range, refreshedAt: null, state: "unavailable" });
  if (!client) return { checkedAt: null, metrics: [
    unavailable("applications", "Applications", "Supabase · waitlist_applications"),
    unavailable("verified", "Verified applicants", "Supabase · waitlist_applications"),
    unavailable("approved", "Approved for invitation", "Supabase · waitlist_applications", "Current approved_for_invite status"),
    unavailable("priority", "Priority access", "Supabase · waitlist_priority_access", "Current granted status"),
    unavailable("invites", "Pending invitations", "Supabase · waitlist_admission_invites", "Issued and unexpired now"),
    unavailable("admissions", "Admitted workspaces", "Supabase · workspace_admissions", "All-time total"),
    unavailable("cohorts", "Active cohorts", "Supabase · workspace_cohort_memberships", "Current memberships"),
    unavailable("share-cards", "Published Share Cards", "Supabase · share_card_publications", "Current published status"),
  ] };

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [applications, verified, approved, priority, invites, admissions, cohorts, cards] = await Promise.all([
    client.from("waitlist_applications").select("id", { count: "exact", head: true }).gte("created_at", since),
    client.from("waitlist_applications").select("id", { count: "exact", head: true }).gte("verified_at", since).not("verified_at", "is", null),
    client.from("waitlist_applications").select("id", { count: "exact", head: true }).eq("status", "approved_for_invite"),
    client.from("waitlist_priority_access").select("id", { count: "exact", head: true }).eq("status", "granted"),
    client.from("waitlist_admission_invites").select("id", { count: "exact", head: true }).eq("status", "issued").gt("expires_at", now.toISOString()),
    client.from("workspace_admissions").select("id", { count: "exact", head: true }),
    client.from("workspace_cohort_memberships").select("cohort", { count: "exact" }).limit(1000),
    client.from("share_card_publications").select("id", { count: "exact", head: true }).eq("publication_state", "published"),
  ]);
  const rows = [applications, verified, approved, priority, invites, admissions, cohorts, cards];
  const metric = (index: number, key: string, label: string, source: string, range = period): Metric => {
    const result = rows[index];
    const cohortData = ((result as { data?: Array<{ cohort: string }> | null }).data) ?? [];
    const cohortCount = (result as { count?: number | null }).count ?? null;
    const truncatedCohorts = index === 6 && cohortCount !== null && cohortData.length < cohortCount;
    const failed = Boolean(result.error) || truncatedCohorts;
    const value = failed ? null : index === 6
      ? new Set(cohortData.map((row) => row.cohort)).size
      : result.count ?? null;
    return { key, label, value, source, range, refreshedAt: failed ? null : checkedAt, state: failed ? "unavailable" : "available" };
  };
  return { checkedAt, metrics: [
    metric(0, "applications", "Applications", "Supabase · waitlist_applications"),
    metric(1, "verified", "Verified applicants", "Supabase · verified_at"),
    metric(2, "approved", "Approved for invitation", "Supabase · waitlist_applications", "Current approved_for_invite status"),
    metric(3, "priority", "Priority access", "Supabase · waitlist_priority_access", "Current granted status"),
    metric(4, "invites", "Pending invitations", "Supabase · waitlist_admission_invites", "Issued and unexpired now"),
    metric(5, "admissions", "Admitted workspaces", "Supabase · workspace_admissions", "All-time total"),
    metric(6, "cohorts", "Active cohorts", "Supabase · workspace_cohort_memberships", "Distinct cohorts with memberships"),
    metric(7, "share-cards", "Published Share Cards", "Supabase · share_card_publications", "Current published status"),
  ] };
}

export async function getRecentAdminActivity(now = new Date()) {
  const client = createAdminServiceClient();
  if (!client) return { rows: null, checkedAt: null, source: "Supabase · admin_audit_events" };
  const result = await client.from("admin_audit_events")
    .select("action,actor_role,outcome,created_at")
    .gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false }).limit(6);
  if (result.error) return { rows: null, checkedAt: null, source: "Supabase · admin_audit_events · last 7 days" };
  return { rows: (result.data ?? []).map((row) => ({ action: String(row.action), role: String(row.actor_role), outcome: String(row.outcome), createdAt: String(row.created_at) })), checkedAt: now.toISOString(), source: "Supabase · admin_audit_events · last 7 days" };
}
