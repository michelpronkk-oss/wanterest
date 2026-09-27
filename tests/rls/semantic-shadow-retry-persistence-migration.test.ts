import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20261023000000_semantic_shadow_retry_persistence_v1.sql"),
  "utf8",
).replace(/--[^\r\n]*/g, "");

describe("semantic shadow retry persistence migration contract", () => {
  it("replaces unconditional identity uniqueness with reusable-artifact uniqueness", () => {
    expect(migration).toContain("drop constraint if exists semantic_shadow_reasoning_workspace_id_product_id_conversation_id_fingerprint_key;");
    expect(migration).toContain("create unique index semantic_shadow_reasoning_reusable_fingerprint_key");
    expect(migration).toContain("where execution_status in ('success', 'cache_hit');");
    expect(migration).toContain("primary key (workspace_id, product_id, conversation_id, fingerprint)");
    expect(migration).not.toMatch(/delete from public\.semantic_shadow_reasoning\b/i);
    expect(migration).not.toMatch(/update public\.semantic_shadow_reasoning\b/i);
  });

  it("keeps the execution guard service-role-only and atomic", () => {
    expect(migration).toContain("create table if not exists public.semantic_shadow_reasoning_claims");
    expect(migration).toContain("alter table public.semantic_shadow_reasoning_claims enable row level security;");
    expect(migration).toContain("revoke all on public.semantic_shadow_reasoning_claims from public, anon, authenticated, service_role;");
    expect(migration).toContain("create or replace function public.claim_semantic_shadow_reasoning");
    expect(migration).toContain("on conflict (workspace_id, product_id, conversation_id, fingerprint) do update");
    expect(migration).toContain("where semantic_shadow_reasoning_claims.expires_at <= timezone('utc', now())");
    expect(migration).toContain("grant execute on function public.claim_semantic_shadow_reasoning");
    expect(migration).toContain("grant execute on function public.release_semantic_shadow_reasoning");
    expect(migration).not.toMatch(/grant\s+(select|insert|update|delete|all)[\s\S]*semantic_shadow_reasoning_claims\s+to\s+(anon|authenticated)/i);
  });

  it("does not broaden the existing semantic-shadow table access contract", () => {
    expect(migration).not.toMatch(/alter table public\.semantic_shadow_reasoning\s+(disable|force)\s+row level security/i);
    expect(migration).not.toMatch(/create policy[\s\S]*semantic_shadow_reasoning/i);
    expect(migration).not.toMatch(/grant[\s\S]*semantic_shadow_reasoning\s+to\s+(anon|authenticated)/i);
  });
});
