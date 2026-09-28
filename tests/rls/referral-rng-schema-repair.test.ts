import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260928010000_layer13a3_referral_rng_schema_repair.sql",
  ),
  "utf8",
);

describe("13A.3 referral RNG schema repair", () => {
  it("qualifies every pgcrypto call used by the repaired SECURITY DEFINER RPCs", () => {
    expect(migration).toContain("extensions.gen_random_bytes(32)");
    expect(migration).toContain("extensions.digest(");
    expect(migration).not.toMatch(/(?<![.\w])gen_random_bytes\s*\(/);
    expect(migration).not.toMatch(/(?<![.\w])digest\s*\(/);
  });

  it("preserves the constrained search path and referral-code entropy contract", () => {
    expect(migration.match(/set search_path = public, auth/g)).toHaveLength(4);
    expect(migration).toContain("extensions.gen_random_bytes(32)");
    expect(migration).toContain("translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_')");
    expect(migration).not.toContain("set search_path = public, auth, extensions");
    expect(migration).not.toContain("set search_path = public, auth, pg_catalog, extensions");
  });

  it("does not alter historical migration SQL", () => {
    const historical = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260927231925_layer13a3_referral_priority_engine_v1.sql",
      ),
      "utf8",
    );
    expect(historical).toContain("gen_random_bytes(32)");
    expect(historical).not.toContain("extensions.gen_random_bytes(32)");
  });
});
