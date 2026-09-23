import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261005000000_paywall_usage_contract_v1.sql"), "utf8");

describe("Paywalls usage contract migration", () => {
  it("separates manual scans from automatic source scans", () => {
    expect(migration).toContain("'manual_scan'");
    expect(migration).toContain("'manual_scans_monthly'");
    expect(migration).toContain("usage_ledger_usage_type_check");
    expect(migration).toContain("p_usage_type not in");
  });

  it("keeps the usage RPC service-role-only and idempotent", () => {
    expect(migration).toContain("p_idempotency_key");
    expect(migration).toContain("if v_existing.id is not null");
    expect(migration).toContain("grant execute on function public.consume_usage");
    expect(migration).toContain("to service_role");
  });
});
