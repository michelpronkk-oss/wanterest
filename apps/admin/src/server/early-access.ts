import "server-only";

import { createAdminServiceClient } from "./supabase";

export const applicationStatuses = ["pending", "verified", "under_review", "approved_for_invite", "declined", "withdrawn"] as const;
export type EarlyAccessRow = {
  id: string;
  number: number | null;
  firstName: string;
  company: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  verifiedReferrals: number | null;
  priorityStatus: string | null;
  inviteStatus: string | null;
  admittedAt: string | null;
  cohort: string | null;
  cohortNumber: number | null;
};

export type EarlyAccessHistoryItem = {
  id: string;
  kind: "application" | "invitation" | "admin";
  action: string;
  createdAt: string;
  reason: string | null;
  status: string | null;
};

export type EarlyAccessDetail = {
  row: EarlyAccessRow;
  verifiedAt: string | null;
  admissionId: string | null;
  workspaceId: string | null;
  latestInviteId: string | null;
  invitations: Array<{ id: string; status: string; issuedAt: string; expiresAt: string }>;
  history: EarlyAccessHistoryItem[] | null;
  historyError: string | null;
};

export async function getEarlyAccessRows(input: { query: string; status: string; now?: Date }): Promise<{ rows: EarlyAccessRow[] | null; checkedAt: string | null; error: string | null }> {
  const client = createAdminServiceClient();
  if (!client) return { rows: null, checkedAt: null, error: "Configure the private server-side Supabase connection to read applicant records." };
  const checkedAt = (input.now ?? new Date()).toISOString();
  const q = input.query.trim().replace(/[^a-zA-Z0-9@._\- ]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  let query = client.from("waitlist_applications").select("id,early_access_number,first_name,company_name,status,email_verification_status,created_at,verified_at").order("created_at", { ascending: false }).limit(30);
  if (applicationStatuses.includes(input.status as (typeof applicationStatuses)[number])) query = query.eq("status", input.status);
  if (q) query = query.or(`first_name.ilike.%${q}%,company_name.ilike.%${q}%,normalized_email.ilike.%${q}%`);
  const applications = await query;
  if (applications.error) return { rows: null, checkedAt: null, error: "The waitlist application read is unavailable." };
  const ids = (applications.data ?? []).map((row) => String(row.id));
  if (!ids.length) return { rows: [], checkedAt, error: null };

  const [invites, admissions, memberships, referrals] = await Promise.all([
    client.from("waitlist_admission_invites").select("waitlist_application_id,status,issued_at").in("waitlist_application_id", ids).order("issued_at", { ascending: false }).limit(ids.length * 4),
    client.from("workspace_admissions").select("waitlist_application_id,admitted_at").in("waitlist_application_id", ids),
    client.from("workspace_cohort_memberships").select("source_waitlist_application_id,cohort,cohort_number").in("source_waitlist_application_id", ids),
    Promise.all([
      client.from("waitlist_referrals").select("referrer_application_id").in("referrer_application_id", ids).eq("status", "verified").limit(10000),
      client.from("waitlist_priority_access").select("waitlist_application_id,status").in("waitlist_application_id", ids),
    ]),
  ]);
  if (invites.error || admissions.error || memberships.error) return { rows: null, checkedAt: null, error: "A related invitation, admission, or cohort read is unavailable." };

  const newestByApplication = <T extends { waitlist_application_id: string }>(items: T[] | null) => new Map((items ?? []).map((item) => [String(item.waitlist_application_id), item]));
  const inviteByApplication = new Map<string, { status: string }>();
  for (const invite of invites.data ?? []) if (!inviteByApplication.has(String(invite.waitlist_application_id))) inviteByApplication.set(String(invite.waitlist_application_id), { status: String(invite.status) });
  const admissionByApplication = newestByApplication(admissions.data as Array<{ waitlist_application_id: string; admitted_at: string }> | null);
  const cohortByApplication = new Map((memberships.data ?? []).map((membership) => [String(membership.source_waitlist_application_id), membership]));
  const [referralRows, priorityRows] = referrals;
  const referralsTruncated = (referralRows.data?.length ?? 0) >= 10000;
  const referralCounts = new Map<string, number>();
  if (!referralRows.error && !referralsTruncated) for (const referral of referralRows.data ?? []) {
    const id = String(referral.referrer_application_id);
    referralCounts.set(id, (referralCounts.get(id) ?? 0) + 1);
  }
  const priorityByApplication = new Map((priorityRows.data ?? []).map((row) => [String(row.waitlist_application_id), String(row.status)]));
  const rows = (applications.data ?? []).map((row) => {
    const id = String(row.id);
    const cohort = cohortByApplication.get(id);
    const admission = admissionByApplication.get(id);
    return {
      id,
      number: typeof row.early_access_number === "number" ? row.early_access_number : row.early_access_number === null ? null : Number(row.early_access_number),
      firstName: String(row.first_name), company: String(row.company_name), status: String(row.status),
      emailVerified: row.email_verification_status === "verified", createdAt: String(row.created_at),
      verifiedReferrals: referralRows.error || referralsTruncated ? null : referralCounts.get(id) ?? 0,
      priorityStatus: priorityRows.error ? null : priorityByApplication.get(id) ?? "normal",
      inviteStatus: inviteByApplication.get(id)?.status ?? null,
      admittedAt: admission?.admitted_at ?? null,
      cohort: cohort ? String(cohort.cohort) : null,
      cohortNumber: cohort ? Number(cohort.cohort_number) : null,
    } satisfies EarlyAccessRow;
  });
  return { rows, checkedAt, error: null };
}

export async function getEarlyAccessDetail(applicationId: string, now = new Date()): Promise<{ detail: EarlyAccessDetail | null; checkedAt: string | null; error: string | null }> {
  const client = createAdminServiceClient();
  if (!client) return { detail: null, checkedAt: null, error: "Configure the private server-side Supabase connection to read applicant records." };
  const checkedAt = now.toISOString();
  const application = await client.from("waitlist_applications")
    .select("id,early_access_number,first_name,company_name,status,email_verification_status,created_at,verified_at")
    .eq("id", applicationId).maybeSingle();
  if (application.error || !application.data) return { detail: null, checkedAt: null, error: "This application is unavailable or could not be read." };

  const row = application.data;
  const id = String(row.id);
  const [events, invitations, admissions, memberships, applicationAudit, referrals, priority] = await Promise.all([
    client.from("waitlist_application_events").select("id,event_type,from_status,to_status,metadata,created_at")
      .eq("application_id", id).order("created_at", { ascending: true }).limit(100),
    client.from("waitlist_admission_invites").select("id,status,issued_at,expires_at,accepted_at,revoked_at")
      .eq("waitlist_application_id", id).order("issued_at", { ascending: false }).limit(20),
    client.from("workspace_admissions").select("id,workspace_id,admitted_at,onboarding_status")
      .eq("waitlist_application_id", id).maybeSingle(),
    client.from("workspace_cohort_memberships").select("cohort,cohort_number")
      .eq("source_waitlist_application_id", id).maybeSingle(),
    client.from("admin_audit_events").select("id,action,created_at,reason,outcome,resource_id")
      .eq("resource_type", "waitlist_application").eq("resource_id", id).order("created_at", { ascending: true }).limit(100),
    client.from("waitlist_referrals").select("id", { count: "exact", head: true }).eq("referrer_application_id", id).eq("status", "verified"),
    client.from("waitlist_priority_access").select("status").eq("waitlist_application_id", id).maybeSingle(),
  ]);
  const hasHistoryError = Boolean(events.error || invitations.error || applicationAudit.error || admissions.error || memberships.error);
  const invitationIds = (invitations.data ?? []).map((invite) => String(invite.id));
  const inviteAudit = invitationIds.length ? await client.from("admin_audit_events")
    .select("id,action,created_at,reason,outcome,resource_id")
    .eq("resource_type", "waitlist_admission_invite").in("resource_id", invitationIds)
    .order("created_at", { ascending: true }).limit(100) : { data: [], error: null };
  const historyError = hasHistoryError || inviteAudit.error ? "Some lifecycle history is currently unavailable." : null;
  const history: EarlyAccessHistoryItem[] = [];
  for (const event of events.data ?? []) {
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : {};
    const reason = typeof metadata.reason === "string" ? metadata.reason.slice(0, 500) : null;
    history.push({
      id: `application-${String(event.id)}`, kind: "application",
      action: String(event.event_type).replaceAll("_", " "), createdAt: String(event.created_at), reason,
      status: event.to_status ? String(event.to_status) : null,
    });
  }
  for (const invite of invitations.data ?? []) {
    history.push({ id: `invite-${String(invite.id)}`, kind: "invitation", action: `Invitation ${String(invite.status)}`,
      createdAt: String(invite.issued_at), reason: null, status: String(invite.status) });
  }
  for (const audit of [...(applicationAudit.data ?? []), ...(inviteAudit.data ?? [])]) {
    history.push({ id: `admin-${String(audit.id)}`, kind: "admin", action: String(audit.action).replaceAll("_", " "),
      createdAt: String(audit.created_at), reason: typeof audit.reason === "string" ? audit.reason : null,
      status: String(audit.outcome) });
  }
  history.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const latestInvite = invitations.data?.[0];
  const admission = admissions.data;
  const cohort = memberships.data;
  return {
    checkedAt,
    error: null,
    detail: {
      row: {
        id, number: typeof row.early_access_number === "number" ? row.early_access_number : row.early_access_number === null ? null : Number(row.early_access_number),
        firstName: String(row.first_name), company: String(row.company_name), status: String(row.status),
        emailVerified: row.email_verification_status === "verified", createdAt: String(row.created_at),
        verifiedReferrals: referrals.error ? null : referrals.count ?? 0,
        priorityStatus: priority.error ? null : priority.data?.status ? String(priority.data.status) : "normal",
        inviteStatus: latestInvite ? String(latestInvite.status) : null,
        admittedAt: admission?.admitted_at ? String(admission.admitted_at) : null,
        cohort: cohort?.cohort ? String(cohort.cohort) : null,
        cohortNumber: cohort?.cohort_number === null || cohort?.cohort_number === undefined ? null : Number(cohort.cohort_number),
      },
      verifiedAt: row.verified_at ? String(row.verified_at) : null,
      admissionId: admission?.id ? String(admission.id) : null,
      workspaceId: admission?.workspace_id ? String(admission.workspace_id) : null,
      latestInviteId: latestInvite?.id ? String(latestInvite.id) : null,
      invitations: (invitations.data ?? []).map((invite) => ({ id: String(invite.id), status: String(invite.status), issuedAt: String(invite.issued_at), expiresAt: String(invite.expires_at) })),
      history: historyError ? null : history,
      historyError,
    },
  };
}
