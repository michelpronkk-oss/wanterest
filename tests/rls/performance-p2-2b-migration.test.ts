import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260928050000_performance_p2_2b_comparable_drift_pair.sql"),
  "utf8",
);

describe("P2.2B comparable drift pair migration contract", () => {
  it("selects the exact newest comparable pair in the database", () => {
    expect(migration).toContain("create or replace function public.find_latest_comparable_drift_pair");
    expect(migration).toContain("current_snapshot.period_end");
    expect(migration).toContain("previous_snapshot.period_end");
    expect(migration).toContain("limit 1");
    expect(migration).toContain("stable");
    expect(migration).toContain("security invoker");
  });

  it("keeps the read primitive service-role-only", () => {
    expect(migration).toContain("revoke all on function public.find_latest_comparable_drift_pair(uuid, uuid, text) from public");
    expect(migration).toContain("revoke all on function public.find_latest_comparable_drift_pair(uuid, uuid, text) from anon, authenticated");
    expect(migration).toContain("grant execute on function public.find_latest_comparable_drift_pair(uuid, uuid, text) to service_role");
  });
});
