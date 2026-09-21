import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261002000000_automatic_monitoring_v1.sql"), "utf8");

describe("Automatic Monitoring v1 migration contract", () => {
  it("defines durable schedules, leases, alert state, and digest delivery state", () => {
    expect(migration).toContain("create table if not exists public.monitoring_schedules");
    expect(migration).toContain("unique (workspace_id, product_id)");
    expect(migration).toContain("create or replace function public.claim_monitoring_schedule");
    expect(migration).toContain("monitoring_alerts");
    expect(migration).toContain("digest_deliveries");
    expect(migration).toContain("lease_expires_at");
  });

  it("keeps tenant integrity and authoritative plan capabilities in the database", () => {
    expect(migration).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id)");
    expect(migration).toContain("public.is_workspace_member(workspace_id)");
    expect(migration).toContain("intelligence_cycles_per_day");
    expect(migration).toContain("deep_refreshes_per_week");
    expect(migration).toContain("x_daily_budget_usd");
    expect(migration).toContain("team_members_capability_missing");
    expect(migration.toLowerCase()).not.toContain("scale");
  });
});
