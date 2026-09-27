import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repair = readFileSync(
  "supabase/migrations/20260927212000_layer13a2_cohort_rpc_repair.sql",
  "utf8",
);

describe("Layer 13A.2 RPC ambiguity repair contract", () => {
  it("qualifies every allocator-state and membership lookup column", () => {
    expect(repair).toMatch(/from public\.workspace_cohort_allocation_state as s/i);
    expect(repair).toMatch(/where s\.cohort = 'founding_25'/i);
    expect(repair).toMatch(/where s\.cohort = 'early_100'/i);
    expect(repair).toMatch(/from public\.workspace_cohort_memberships as m/i);
    expect(repair).toMatch(/where m\.workspace_id = p_workspace_id/i);
    expect(repair).toMatch(/where m\.source_waitlist_application_id = p_source_waitlist_application_id/i);
    expect(repair).toMatch(/update public\.workspace_cohort_allocation_state as s/i);
    expect(repair).toMatch(/set next_number = s\.next_number \+ 1, assigned_count = s\.assigned_count \+ 1/i);
    expect(repair).not.toMatch(/where\s+cohort\s*=/i);
    expect(repair).not.toMatch(/where\s+workspace_id\s*=/i);
  });

  it("preserves the authoritative RPC contract and service-role boundary", () => {
    expect(repair).toMatch(/create or replace function public\.assign_workspace_cohort_membership/i);
    expect(repair).toMatch(/if not public\.is_service_role\(\)/i);
    expect(repair).toMatch(/revoke all on function public\.assign_workspace_cohort_membership\(uuid, uuid, uuid, text, text\) from public, anon, authenticated/i);
    expect(repair).toMatch(/grant execute on function public\.assign_workspace_cohort_membership\(uuid, uuid, uuid, text, text\) to service_role/i);
    expect(repair).toMatch(/for update/i);
    expect(repair).toMatch(/no_special_cohort/i);
  });
});
