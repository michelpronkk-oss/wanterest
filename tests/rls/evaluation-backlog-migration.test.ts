import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261106000000_evaluation_backlog_v1.sql"), "utf8").toLowerCase();

describe("evaluation backlog migration", () => {
  it("keeps the queue service-role-only with RLS and no destructive grant", () => {
    expect(sql).toContain("create table public.evaluation_backlog");
    expect(sql).toContain("alter table public.evaluation_backlog enable row level security");
    expect(sql).toContain("revoke all on table public.evaluation_backlog from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update on table public.evaluation_backlog to service_role");
    expect(sql).not.toMatch(/grant\s+(?:all|delete|truncate|references|trigger)\b[^;]*to\s+service_role/);
    expect(sql).not.toMatch(/grant\s+[^;]*\bon\s+table\s+public\.evaluation_backlog\s+to\s+(?:public|anon|authenticated)/);
  });

  it("binds queue identity to product, root, profile and input fingerprint", () => {
    expect(sql).toContain("unique (workspace_id, product_id, conversation_id, demand_profile_id, selection_fingerprint)");
    expect(sql).toContain("foreign key (workspace_id, product_id)");
    expect(sql).toContain("foreign key (workspace_id, demand_profile_id)");
    expect(sql).toContain("foreign key (workspace_id, evaluation_id)");
    expect(sql).toContain("foreign key (workspace_id, signal_id)");
    expect(sql).not.toMatch(/^\s*(body|title|author_name|author_id|payload_json|raw_content)\s+/m);
  });

  it("claims atomically with a hard batch bound and stale lease recovery", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("p_limit > 10");
    expect(sql).toContain("interval '20 minutes'");
    expect(sql).toContain("attempt_count >= 3");
    expect(sql).toContain("order by b.priority_score desc, b.created_at, b.id");
    expect(sql).toContain("first_leased_at = coalesce(b.first_leased_at");
    expect(sql).toContain("b.first_leased_at - b.created_at");
  });

  it("restricts both RPCs and avoids SECURITY DEFINER", () => {
    for (const routine of ["claim_evaluation_backlog(uuid, integer)", "evaluation_backlog_summary()"])
      expect(sql).toContain(`grant execute on function public.${routine} to service_role`);
    expect(sql).toContain("security invoker set search_path = ''");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("revoke all on function public.claim_evaluation_backlog(uuid, integer) from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.evaluation_backlog_summary() from public, anon, authenticated");
  });
});
