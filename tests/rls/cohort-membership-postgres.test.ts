import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Opt-in real-PostgreSQL proof. It never targets Supabase or production: set
 * WANTEREST_PG_TEST_HOST to a throwaway local PostgreSQL server only.
 */
const host = process.env.WANTEREST_PG_TEST_HOST;
const port = process.env.WANTEREST_PG_TEST_PORT ?? "5432";
const user = process.env.WANTEREST_PG_TEST_USER ?? "postgres";
const database = `wanterest_13a2_${process.pid}`;
const root = process.cwd();
const PRINCIPAL = "10000000-0000-4000-8000-000000000001";
const OTHER_USER = "10000000-0000-4000-8000-000000000002";
const WS1 = "30000000-0000-4000-8000-000000000001";
const WS2 = "30000000-0000-4000-8000-000000000002";
const WS3 = "30000000-0000-4000-8000-000000000003";
const WS4 = "30000000-0000-4000-8000-000000000004";
const WS5 = "30000000-0000-4000-8000-000000000005";
const WAITLIST = "40000000-0000-4000-8000-000000000001";

function psql(db: string, args: string[]): string {
  return execFileSync(
    "psql",
    ["-h", host!, "-p", port, "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", ...args],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

type Run = { code: number | null; stdout: string; stderr: string };

function psqlAsync(sql: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("psql", ["-h", host!, "-p", port, "-U", user, "-d", database, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function assignmentSql(workspaceId: string, waitlistId?: string): string {
  const source = waitlistId ? `'${waitlistId}'` : "null";
  return `select assignment_status || ':' || coalesce(cohort, 'none') || ':' || coalesce(cohort_number::text, 'none') from public.assign_workspace_cohort_membership('${workspaceId}', ${source}, '${PRINCIPAL}')`;
}

function transactionAssignmentSql(workspaceId: string): string {
  return `set request.jwt.claim.role = 'service_role'; begin; ${assignmentSql(workspaceId)}; select pg_sleep(1); commit;`;
}

function workspaceInsertSql(workspaceId: string, slug: string, owner = PRINCIPAL): string {
  return `insert into public.workspaces (id, name, slug, created_by) values ('${workspaceId}', '${slug}', '${slug}', '${owner}') on conflict (id) do nothing;`;
}

describe.skipIf(!host)("Layer 13A.2 cohort membership on real PostgreSQL", () => {
  it("proves allocation, rollback, caps, security, immutability, and lifecycle independence", async () => {
    psql("postgres", ["-c", `drop database if exists ${database}`]);
    psql("postgres", ["-c", `create database ${database}`]);
    try {
      psql(database, ["-f", path.join(root, "tests/rls/sql/supabase_stub_bootstrap.sql")]);
      for (const file of readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
        psql(database, ["-f", path.join(root, "supabase/migrations", file)]);
      }

      psql(database, ["-c", `
        set request.jwt.claim.role = 'service_role';
        insert into auth.users (id, email) values ('${PRINCIPAL}', 'principal@example.test'), ('${OTHER_USER}', 'other@example.test') on conflict (id) do nothing;
        ${workspaceInsertSql(WS1, "cohort-one")}
        ${workspaceInsertSql(WS2, "cohort-two")}
        ${workspaceInsertSql(WS3, "cohort-three")}
        ${workspaceInsertSql(WS4, "cohort-four")}
        ${workspaceInsertSql(WS5, "cohort-five")}
        ${workspaceInsertSql("30000000-0000-4000-8000-000000000006", "cohort-six")}
        ${workspaceInsertSql("30000000-0000-4000-8000-000000000007", "cohort-seven")}
        insert into public.workspace_members (workspace_id, user_id, role, status) values
          ('${WS1}', '${PRINCIPAL}', 'owner', 'active') on conflict do nothing;
        insert into public.waitlist_applications (
          id, early_access_number, email, normalized_email, first_name, company_name, use_case,
          status, email_verification_status, verification_token_hash, verification_expires_at,
          verification_used_at, verified_at, status_token_hash
        ) values (
          '${WAITLIST}', 1, 'source@example.test', 'source@example.test', 'Source', 'Source Company', 'Historical provenance fixture',
          'verified', 'verified', repeat('a', 64), now() + interval '1 day', now(), now(), repeat('b', 64)
        );
        select count(*) from public.workspace_cohort_memberships;
      `]);

      expect(psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; ${assignmentSql(WS1, WAITLIST)}`])).toContain("assigned:founding_25:1");
      expect(psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; ${assignmentSql(WS1, WAITLIST)}`])).toContain("existing:founding_25:1");

      const rollback = await psqlAsync(`set request.jwt.claim.role = 'service_role'; begin; ${assignmentSql(WS2)}; do $$ begin raise exception 'rollback_fixture'; end $$; commit;`);
      expect(rollback.code).not.toBe(0);
      expect(psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; ${assignmentSql(WS2)}`])).toContain("assigned:founding_25:2");

      const sameWorkspace = await Promise.all([
        psqlAsync(transactionAssignmentSql(WS3)),
        new Promise<Run>((resolve) => setTimeout(() => resolve(psqlAsync(transactionAssignmentSql(WS3))), 100)),
      ]);
      expect(sameWorkspace.every((run) => run.code === 0)).toBe(true);
      expect(psql(database, ["-c", `select count(*) from public.workspace_cohort_memberships where workspace_id='${WS3}'`])).toBe("1");

      const differentWorkspaces = await Promise.all([
        psqlAsync(transactionAssignmentSql(WS4)),
        new Promise<Run>((resolve) => setTimeout(() => resolve(psqlAsync(transactionAssignmentSql(WS5))), 100)),
      ]);
      expect(differentWorkspaces.every((run) => run.code === 0)).toBe(true);
      expect(psql(database, ["-c", `select count(distinct cohort_number) from public.workspace_cohort_memberships where workspace_id in ('${WS4}', '${WS5}')`])).toBe("2");

      psql(database, ["-c", `
        set request.jwt.claim.role = 'service_role';
        do $$
        declare
          v_id uuid;
          v_result record;
          v_slug text;
        begin
          while (select assigned_count from public.workspace_cohort_allocation_state where cohort='founding_25') < 25 loop
            v_id := gen_random_uuid();
            v_slug := 'founding-' || replace(v_id::text, '-', '');
            insert into public.workspaces (id, name, slug, created_by) values (v_id, v_slug, v_slug, '${PRINCIPAL}');
            select * into v_result from public.assign_workspace_cohort_membership(v_id, null, '${PRINCIPAL}');
            if v_result.cohort <> 'founding_25' then raise exception 'founding_cap_fixture_wrong_cohort'; end if;
          end loop;
        end $$;
      `]);
      expect(psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; ${assignmentSql("30000000-0000-4000-8000-000000000006")}`])).toContain("assigned:early_100:1");

      psql(database, ["-c", `
        set request.jwt.claim.role = 'service_role';
        do $$
        declare
          v_id uuid;
          v_result record;
          v_slug text;
        begin
          while (select assigned_count from public.workspace_cohort_allocation_state where cohort='early_100') < 100 loop
            v_id := gen_random_uuid();
            v_slug := 'early-' || replace(v_id::text, '-', '');
            insert into public.workspaces (id, name, slug, created_by) values (v_id, v_slug, v_slug, '${PRINCIPAL}');
            select * into v_result from public.assign_workspace_cohort_membership(v_id, null, '${PRINCIPAL}');
            if v_result.cohort <> 'early_100' then raise exception 'early_cap_fixture_wrong_cohort'; end if;
          end loop;
        end $$;
      `]);
      const noSpecial = psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; ${assignmentSql("30000000-0000-4000-8000-000000000007")}`]);
      expect(noSpecial).toContain("no_special_cohort:none:none");
      expect(psql(database, ["-c", "select assigned_count || ':' || next_number from public.workspace_cohort_allocation_state where cohort='founding_25'"])).toBe("25:26");
      expect(psql(database, ["-c", "select assigned_count || ':' || next_number from public.workspace_cohort_allocation_state where cohort='early_100'"])).toBe("100:101");
      expect(psql(database, ["-c", "select count(*) from public.workspace_cohort_memberships"])).toBe("125");
      expect(psql(database, ["-c", "select count(*) from public.workspace_cohort_membership_events"])).toBe("125");

      const immutableUpdate = await psqlAsync(`set request.jwt.claim.role = 'service_role'; update public.workspace_cohort_memberships set cohort_number=2 where workspace_id='${WS1}';`);
      expect(immutableUpdate.code).not.toBe(0);
      const immutableDelete = await psqlAsync(`set request.jwt.claim.role = 'service_role'; delete from public.workspace_cohort_memberships where workspace_id='${WS1}';`);
      expect(immutableDelete.code).not.toBe(0);
      const eventDelete = await psqlAsync(`set request.jwt.claim.role = 'service_role'; delete from public.workspace_cohort_membership_events where workspace_id='${WS1}';`);
      expect(eventDelete.code).not.toBe(0);

      const anonymousRead = await psqlAsync("set request.jwt.claim.role = 'anon'; select count(*) from public.workspace_cohort_memberships;");
      expect(anonymousRead.code).not.toBe(0);
      const anonymousAssign = await psqlAsync(`set request.jwt.claim.role = 'anon'; select * from public.assign_workspace_cohort_membership('${WS1}');`);
      expect(anonymousAssign.code).not.toBe(0);
      const authenticatedUnrelatedRead = await psqlAsync(`set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '${OTHER_USER}'; select * from public.get_workspace_cohort_identity('${WS1}');`);
      expect(authenticatedUnrelatedRead.code).not.toBe(0);
      const authenticatedRead = psql(database, ["-c", `set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '${PRINCIPAL}'; select cohort || ':' || cohort_number || ':' || cohort_limit || ':' || display_identity || ':' || workspace_status from public.get_workspace_cohort_identity('${WS1}')`]);
      expect(authenticatedRead).toBe("founding_25:1:25:Founding 25:active");

      psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; update public.workspaces set status='archived' where id='${WS1}';`]);
      expect(psql(database, ["-c", `set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '${PRINCIPAL}'; select cohort || ':' || cohort_number || ':' || workspace_status from public.get_workspace_cohort_identity('${WS1}')`])).toBe("founding_25:1:archived");
      psql(database, ["-c", `set request.jwt.claim.role = 'service_role'; update public.workspaces set status='active' where id='${WS1}';`]);
      expect(psql(database, ["-c", `select early_access_number from public.waitlist_applications where id='${WAITLIST}'`])).toBe("1");
    } finally {
      psql("postgres", ["-c", `drop database if exists ${database} with (force)`]);
    }
  }, 180_000);
});
