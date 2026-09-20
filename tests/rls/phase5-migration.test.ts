import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260923000000_phase5_actions_digests.sql"), "utf8");

describe("Phase 5 actions and digests migration contract", () => {
  it("creates relational action, feedback, event, digest, and variant tables with RLS", () => {
    for (const table of ["actions", "action_variants", "action_feedback", "action_events", "digests", "digest_items"]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`public.is_workspace_member(workspace_id)`);
    }
    expect(migration).toContain("action_variants_immutable");
    expect(migration).toContain("action_feedback_append_only");
    expect(migration).toContain("digest_items_immutable");
  });

  it("enforces workspace integrity, trigger evidence, and idempotency", () => {
    expect(migration).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id)");
    expect(migration).toContain("foreign key (workspace_id, action_id) references public.actions(workspace_id, id)");
    expect(migration).toContain("foreign key (workspace_id, digest_id) references public.digests(workspace_id, id)");
    expect(migration).toContain("validate_action_trigger");
    expect(migration).toContain("action_trigger_evidence_mismatch");
    expect(migration).toContain("unique (workspace_id, idempotency_key)");
    expect(migration).toContain("generate-actions");
    expect(migration).toContain("build-digest");
  });

  it("keeps experiments, billing, and delivery out of Phase 5", () => {
    expect(migration).not.toContain("create table if not exists public.experiments");
    expect(migration).not.toContain("dodo");
    expect(migration).not.toContain("resend");
  });
});
