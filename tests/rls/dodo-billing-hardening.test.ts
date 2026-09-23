import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261004000000_dodo_billing_v1_hardening.sql"), "utf8");

describe("Dodo billing hardening migration contract", () => {
  it("adds durable attempts and an atomic service-role webhook claim", () => {
    expect(migration).toContain("add column if not exists attempts integer not null default 0");
    expect(migration).toContain("create or replace function public.claim_billing_webhook");
    expect(migration).toContain("processing_status in ('received', 'failed')");
    expect(migration).toContain("attempts = attempts + 1");
    expect(migration).toContain("service_role_required");
  });
});
