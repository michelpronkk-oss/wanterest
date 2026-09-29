import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261101000000_layer13b1_dynamic_share_card_engine_v1.sql"), "utf8");

describe("Layer 13B.1 share-card migration contract", () => {
  it("keeps publication storage explicit, revocable, and owner-scoped", () => {
    expect(migration).toContain("create table if not exists public.share_card_publications");
    expect(migration).toContain("publication_state text not null default 'published'");
    expect(migration).toContain("check (((workspace_id is not null)::integer + (waitlist_application_id is not null)::integer) = 1)");
    expect(migration).toContain("share_card_publications_workspace_variant_idx");
    expect(migration).toContain("share_card_publications_application_variant_idx");
    expect(migration).toContain("pass_visible = true");
  });

  it("protects private rows and exposes only the narrow public/event RPCs", () => {
    expect(migration).toContain("alter table public.share_card_publications enable row level security");
    expect(migration).toContain("revoke all on public.share_card_publications from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role");
    expect(migration).toContain("and (publication.variant <> 'PRIORITY_ACCESS' or priority.id is not null)");
    expect(migration).toContain("and (publication.variant in ('EARLY_ACCESS', 'PRIORITY_ACCESS') or profile.id is not null)");
    expect(migration).toContain("grant execute on function public.record_share_card_event(text, text, text) to anon, authenticated, service_role");
  });

  it("is ordered after the latest applied migration and projects the Board 15 fields", () => {
    expect(migration).toContain("case when coalesce(publication.snapshot ->> 'monogram', '') ~ '^[A-Z0-9]{1,3}$'");
    expect(migration).toContain("then (publication.snapshot ->> 'admitted_on')::date else null end");
    expect(migration).toContain("publication.snapshot ->> 'display_name'");
  });

  it("does not make public slugs mutation credentials", () => {
    expect(migration).toContain("grant execute on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid) to service_role");
    expect(migration).toContain("grant execute on function public.revoke_share_card(uuid, uuid, text, uuid) to service_role");
    expect(migration).not.toContain("grant execute on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid) to anon");
  });
});
