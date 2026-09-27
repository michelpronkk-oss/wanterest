import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260927231925_layer13a3_referral_priority_engine_v1.sql"), "utf8");
const repository = readFileSync(resolve(process.cwd(), "src/server/modules/waitlist/waitlist.repository.ts"), "utf8");

describe("13A.3 referral and priority migration contract", () => {
  it("uses separate additive tables and preserves immutable attribution history", () => {
    expect(migration).toContain("create table if not exists public.waitlist_referral_identities");
    expect(migration).toContain("create table if not exists public.waitlist_referrals");
    expect(migration).toContain("create table if not exists public.waitlist_priority_access");
    expect(migration).toContain("create table if not exists public.waitlist_referral_events");
    expect(migration).toContain("unique (referred_application_id)");
    expect(migration).toContain("foreign key (referral_identity_id, referrer_application_id)");
    expect(migration).toContain("check (status <> 'pending' or verified_at is null)");
    expect(migration).toContain("waitlist_referral_events_append_only");
    expect(migration).toContain("No existing waitlist application receives a referral identity");
    expect(migration).not.toMatch(/insert\s+into\s+public\.waitlist_referral_identities\s+select/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.waitlist_priority_access\s+select/i);
  });

  it("keeps public roles unable to read or mutate private referral state", () => {
    for (const table of ["waitlist_referral_identities", "waitlist_referrals", "waitlist_priority_access", "waitlist_referral_events"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated`);
      expect(migration).toContain(`grant all on public.${table} to service_role`);
    }
    expect(migration).toContain("grant execute on function public.ensure_waitlist_referral_identity(uuid) to service_role");
    expect(migration).toContain("revoke all on function public.get_waitlist_referral_status(uuid) from public, anon, authenticated");
    expect(migration).not.toContain("grant all on public.waitlist_referrals to anon");
    expect(migration).not.toContain("grant all on public.waitlist_referrals to authenticated");
  });

  it("pins the approved policy and serializes threshold decisions", () => {
    expect(migration).toContain("p_policy_key is null or char_length(trim(p_policy_key)) not between 1 and 120 or p_threshold is null or p_threshold < 1");
    expect(migration).toContain("perform public.ensure_waitlist_referral_identity(p_referred_application_id)");
    expect(migration).toContain("create or replace function public.verify_waitlist_application_with_referral");
    expect(migration).toContain("perform public.process_waitlist_referral_verification(v_application.id, p_policy_key, p_threshold)");
    expect(migration).toContain("grant execute on function public.verify_waitlist_application_with_referral(text, text, integer) to service_role");
    expect(repository).toContain('client.rpc("verify_waitlist_application_with_referral"');
    expect(repository).toContain("priorityReferralPolicy.policyKey");
    expect(repository).toContain("priorityReferralPolicy.threshold");
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(lower(trim(p_normalized_email)), 0))");
    expect(migration).toContain("where id = v_referral.referrer_application_id for update");
    expect(migration).toContain("unique (waitlist_application_id)");
    expect(migration).toContain("priority-granted:' || v_priority.id::text");
  });
});
