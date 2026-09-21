import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("scan dispatch recovery migration contract", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261001000000_scan_dispatch_recovery.sql"), "utf8");

  it("persists dispatch state and recovery timestamps", () => {
    expect(migration).toContain("dispatch_status text not null default 'unclaimed'");
    expect(migration).toContain("dispatch_claimed_at timestamptz");
    expect(migration).toContain("dispatch_checked_at timestamptz");
    expect(migration).toContain("job_runs_dispatch_recovery_idx");
  });

  it("backfills linked and terminal rows without weakening job RLS", () => {
    expect(migration).toContain("where trigger_run_id is not null");
    expect(migration).toContain("where status in ('failed', 'failed_terminal', 'cancelled')");
    expect(migration).not.toContain("disable row level security");
    expect(migration).not.toContain("grant all on public.job_runs to authenticated");
  });
});
