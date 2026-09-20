import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260920000000_phase2_ingestion.sql"),
  "utf8",
);

describe("Phase 2 ingestion migration contract", () => {
  it("creates the raw, canonical, health, job, and provenance tables", () => {
    for (const table of [
      "job_runs",
      "evidence_nodes",
      "raw_source_items",
      "source_items",
      "conversations",
      "conversation_source_items",
      "source_health",
      "evidence_provenance",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
  });

  it("protects raw history and stable canonical identities", () => {
    expect(migration).toContain("unique (source_key, external_id, payload_hash)");
    expect(migration).toContain("unique (source_key, external_id)");
    expect(migration).toContain("check (payload_json is not null or payload_uri is not null)");
    expect(migration).toContain("raw_source_items_are_append_only");
    expect(migration).toContain("primary key (conversation_id, source_item_id)");
    expect(migration).toContain("conversation_source_items_one_primary_idx");
  });

  it("keeps internal access service-only and provenance inspectable", () => {
    expect(migration).toContain("grant all on public.raw_source_items to service_role");
    expect(migration).toContain("grant all on public.conversations to service_role");
    expect(migration).toContain("derived_evidence_node_id");
    expect(migration).toContain("source_evidence_node_id");
    expect(migration).toContain("engine_version_id uuid references public.engine_versions(id)");
  });
});
