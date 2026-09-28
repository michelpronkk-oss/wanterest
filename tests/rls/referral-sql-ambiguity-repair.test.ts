import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260928020000_layer13a3_referral_sql_ambiguity_repair.sql",
  ),
  "utf8",
);

describe("13A.3 referral SQL ambiguity repair", () => {
  it("qualifies verification-continuation table references", () => {
    expect(migration).toContain("from public.waitlist_referrals as wr");
    expect(migration).toContain("wr.referred_application_id = p_referred_application_id");
    expect(migration).toContain("wr.referrer_application_id = v_referral.referrer_application_id");
    expect(migration).not.toMatch(/\bwhere\s+referrer_application_id\s*=/);
    expect(migration).not.toMatch(/\bwhere\s+referred_application_id\s*=/);
  });

  it("preserves the RPC contract and constrained security boundary", () => {
    expect(migration).toContain(
      "returns table (referrer_application_id uuid, verified_count integer, priority_status text)",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, auth");
    expect(migration).toContain("extensions.digest(");
    expect(migration).not.toContain("set search_path = public, auth, extensions");
    expect(migration).not.toContain("#variable_conflict");
  });
});
