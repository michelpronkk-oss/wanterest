import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261011000000_signal_lifecycle_v1.sql"), "utf8");

describe("Signal Lifecycle V1 migration contract", () => {
  it("adds lifecycle audit fields without deleting signal history", () => {
    for (const column of ["invalidated_at", "invalidated_reason", "invalidated_by", "retracted_at", "retracted_reason", "retracted_by", "lifecycle_version"]) {
      expect(migration).toContain(`add column if not exists ${column}`);
    }
    expect(migration).toContain("add constraint signals_lifecycle_status_check");
    expect(migration).toContain("'invalidated', 'retracted'");
    expect(migration).not.toContain("delete from public.signals");
  });

  it("invalidates only the exact confirmed Jira signal and conversation", () => {
    expect(migration).toContain("0774492f-fee2-450f-9ffe-98956b9bb1c6");
    expect(migration).toContain("64ecae9e-4ec9-53d7-aaa5-0bbc459cbf2f");
    expect(migration).toContain("historical_clause_binding_false_positive");
    expect(migration).toContain("lifecycle_status = 'invalidated'");
    expect(migration).toContain("and lifecycle_status not in ('invalidated', 'retracted')");
  });

  it("keeps user lifecycle RPCs from reactivating terminal states", () => {
    expect(migration).toContain("terminal_signal_lifecycle");
    expect(migration).toContain("v_signal.lifecycle_status in ('invalidated', 'retracted')");
    expect(migration).toContain("for update");
  });
});
