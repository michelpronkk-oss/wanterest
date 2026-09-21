import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260930000000_background_usage_authorization.sql"),
  "utf8",
);
const phase1Migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260919000000_phase1_foundation.sql"),
  "utf8",
);
const phase2Migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260920000000_phase2_ingestion.sql"),
  "utf8",
);

describe("trusted background usage authorization migration", () => {
  it("recognizes both Supabase JWT role claim layouts", () => {
    expect(migration).toContain("request.jwt.claim.role");
    expect(migration).toContain("request.jwt.claims");
    expect(migration).toContain("->> 'role'");
    expect(migration).toContain("= 'service_role'");
  });

  it("does not change browser grants or disable RLS", () => {
    expect(migration).not.toContain("grant execute");
    expect(migration).not.toContain("grant all");
    expect(migration).not.toContain("disable row level security");
    expect(migration).not.toContain("authenticated");
    expect(migration).not.toContain("anon");
  });

  it("retains database-enforced usage and job idempotency", () => {
    expect(phase1Migration).toContain("unique (workspace_id, idempotency_key)");
    expect(phase2Migration).toContain("unique (job_type, idempotency_key)");
  });
});
