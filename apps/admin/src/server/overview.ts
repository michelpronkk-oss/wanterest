import "server-only";

import { createAdminServiceClient } from "./supabase";

export type Metric = { key: string; label: string; value: number | null; source: string; range: string; refreshedAt: string | null; state: "available" | "unavailable" };

const period = "Trailing 30 days (UTC)";

export async function getOverviewMetrics(now = new Date()): Promise<{ checkedAt: string | null; metrics: Metric[] }> {
  const client = createAdminServiceClient();
  const checkedAt = now.toISOString();
  const unavailable = (key: string, label: string, source: string, range = period): Metric => ({ key, label, value: null, source, range, refreshedAt: null, state: "unavailable" });
  if (!client) return { checkedAt: null, metrics: [
    unavailable("applications", "Applications", "Supabase · waitlist_applications"),
    unavailable("verified", "Verified applicants", "Supabase · waitlist_applications"),
    unavailable("priority", "Priority access", "Supabase · waitlist_priority_access", "Current granted status"),
    unavailable("invites", "Invitations issued", "Supabase · waitlist_admission_invites"),
    unavailable("admissions", "Admissions", "Supabase · workspace_admissions"),
    unavailable("cohorts", "Active cohorts", "Supabase · workspace_cohort_memberships", "Current memberships"),
    unavailable("share-cards", "Published Share Cards", "Supabase · share_card_publications", "Current published status"),
  ] };

  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [applications, verified, priority, invites, admissions, cohorts, cards] = await Promise.all([
    client.from("waitlist_applications").select("id", { count: "exact", head: true }).gte("created_at", since),
    client.from("waitlist_applications").select("id", { count: "exact", head: true }).gte("verified_at", since).not("verified_at", "is", null),
    client.from("waitlist_priority_access").select("id", { count: "exact", head: true }).eq("status", "granted"),
    client.from("waitlist_admission_invites").select("id", { count: "exact", head: true }).gte("issued_at", since),
    client.from("workspace_admissions").select("id", { count: "exact", head: true }).gte("admitted_at", since),
    client.from("workspace_cohort_memberships").select("cohort"),
    client.from("share_card_publications").select("id", { count: "exact", head: true }).eq("publication_state", "published"),
  ]);
  const rows = [applications, verified, priority, invites, admissions, cohorts, cards];
  const metric = (index: number, key: string, label: string, source: string, range = period): Metric => {
    const result = rows[index];
    const failed = Boolean(result.error);
    const value = failed ? null : index === 5
      ? new Set((((result as { data?: Array<{ cohort: string }> | null }).data) ?? []).map((row) => row.cohort)).size
      : result.count ?? null;
    return { key, label, value, source, range, refreshedAt: failed ? null : checkedAt, state: failed ? "unavailable" : "available" };
  };
  return { checkedAt, metrics: [
    metric(0, "applications", "Applications", "Supabase · waitlist_applications"),
    metric(1, "verified", "Verified applicants", "Supabase · verified_at"),
    metric(2, "priority", "Priority access", "Supabase · waitlist_priority_access", "Current granted status"),
    metric(3, "invites", "Invitations issued", "Supabase · waitlist_admission_invites"),
    metric(4, "admissions", "Admissions", "Supabase · workspace_admissions"),
    metric(5, "cohorts", "Active cohorts", "Supabase · workspace_cohort_memberships", "Distinct cohorts with memberships"),
    metric(6, "share-cards", "Published Share Cards", "Supabase · share_card_publications", "Current published status"),
  ] };
}
