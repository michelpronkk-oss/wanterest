import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261104000000_admin_operations_growth_v1.sql"), "utf8").toLowerCase();
const admissionMigration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260928031157_layer13a6_launch_access_mode_v1.sql"), "utf8").toLowerCase();
const detailPage = readFileSync(path.resolve(process.cwd(), "apps/admin/src/app/early-access/[applicationId]/page.tsx"), "utf8").toLowerCase();
const rpcSignatures = [
  "public.admin_transition_waitlist_application(uuid, text, uuid, text, uuid)",
  "public.admin_issue_waitlist_invite(uuid, text, uuid, uuid, text)",
  "public.admin_revoke_waitlist_invite(uuid, uuid, text, uuid)",
  "public.admin_record_invite_delivery(uuid, uuid, uuid, text)",
  "public.admin_growth_daily_metrics(date, date)",
];

describe("Admin Operations + Growth migration security contract", () => {
  it("pins every privileged routine to an empty search path and service_role-only execution", () => {
    const functionBodies = migration.split(/create or replace function public\./).slice(1);
    expect(functionBodies).toHaveLength(5);
    for (const body of functionBodies) {
      expect(body.slice(0, body.indexOf("as $$"))).toMatch(/security definer[\s\S]*set search_path = ''/);
      expect(body).toContain("public.is_service_role()");
    }
    for (const signature of rpcSignatures) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(migration).toContain(`grant execute on function ${signature} to service_role`);
    }
    expect(migration).not.toMatch(/grant execute on function public\.admin_[\s\S]{0,180}to authenticated/i);
  });

  it("requires active Founder or Operations Admin membership and preserves the canonical waitlist lifecycle", () => {
    expect(migration).toMatch(/membership\.status = 'active'[\s\S]{0,120}membership\.role in \('founder', 'operations_admin'\)/);
    expect(migration).toContain("public.transition_waitlist_application(p_application_id, 'under_review'");
    expect(migration).toContain("public.transition_waitlist_application(p_application_id, 'approved_for_invite'");
    expect(migration).toContain("public.transition_waitlist_application(p_application_id, 'declined'");
    expect(migration).toContain("public.issue_waitlist_admission_invite(p_application_id, p_token_hash, p_actor_user_id)");
    expect(migration).toContain("public.revoke_waitlist_admission_invite(p_invite_id, p_actor_user_id, trim(p_reason))");
    expect(migration).not.toMatch(/update\s+public\.waitlist_applications/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.(workspace_admissions|workspace_cohort_memberships)/i);
    expect(migration).not.toContain("public.provision_workspace_admission(");
  });

  it("serializes retries and writes atomic append-only audit context without recipient data or invite secrets", () => {
    expect(migration).toContain("admin_audit_events_request_idempotency_idx");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("insert into public.admin_audit_events");
    expect(migration).toContain("'idempotent', true");
    expect(migration).toMatch(/p_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(migration).not.toMatch(/(recipient_email|raw_token|qr_code|secret|email_address)\s*,\s*(request_id|outcome|context)/);
    expect(migration).not.toMatch(/raise\s+notice[\s\S]{0,120}(token|email|secret)/i);
  });

  it("validates a bounded UTC range and reads lifecycle events instead of visitor analytics", () => {
    expect(migration).toContain("p_end_date - p_start_date > 366");
    expect(migration).toContain("at time zone 'utc'");
    for (const table of ["waitlist_applications", "waitlist_application_events", "waitlist_priority_access", "waitlist_admission_events", "workspace_admissions"]) {
      expect(migration).toContain(`from public.${table}`);
    }
    expect(migration).not.toContain("utm_");
  });

  it("leaves admission and permanent cohort allocation to the existing concurrency-safe admission service", () => {
    expect(admissionMigration).toContain("create or replace function public.provision_workspace_admission");
    expect(admissionMigration).toContain("pg_advisory_xact_lock(hashtextextended(v_expected_key, 0))");
    expect(admissionMigration).toContain("assign_workspace_cohort_membership_with_benefit");
    expect(migration).not.toContain("public.provision_workspace_admission(");
    expect(detailPage).not.toContain('operation="admit"');
    expect(detailPage).toContain("there is no separate manual admission action");
  });
});
