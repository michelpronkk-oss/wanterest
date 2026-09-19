import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const integrationConfig = {
  url: process.env.SUPABASE_RLS_TEST_URL,
  anonKey: process.env.SUPABASE_RLS_TEST_ANON_KEY,
  workspaceA: process.env.SUPABASE_RLS_WORKSPACE_A,
  workspaceB: process.env.SUPABASE_RLS_WORKSPACE_B,
  userAToken: process.env.SUPABASE_RLS_USER_A_TOKEN,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  memberBId: process.env.SUPABASE_RLS_MEMBER_B_ID,
};

const rlsReady = [
  integrationConfig.url,
  integrationConfig.anonKey,
  integrationConfig.workspaceA,
  integrationConfig.workspaceB,
  integrationConfig.userAToken,
].every(Boolean);

const compositeFkReady = [
  integrationConfig.url,
  integrationConfig.serviceRoleKey,
  integrationConfig.workspaceA,
  integrationConfig.memberBId,
].every(Boolean);

describe.skipIf(!rlsReady)("live Supabase RLS isolation", () => {
  it("does not expose another workspace through a member JWT", async () => {
    const client = createClient(
      integrationConfig.url!,
      integrationConfig.anonKey!,
      { global: { headers: { Authorization: `Bearer ${integrationConfig.userAToken}` } } },
    );

    const { data, error } = await client
      .from("workspaces")
      .select("id")
      .eq("id", integrationConfig.workspaceB!)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("does not allow a member to mutate another workspace", async () => {
    const client = createClient(
      integrationConfig.url!,
      integrationConfig.anonKey!,
      { global: { headers: { Authorization: `Bearer ${integrationConfig.userAToken}` } } },
    );

    const { data, error } = await client
      .from("workspaces")
      .update({ name: "must-not-update" })
      .eq("id", integrationConfig.workspaceB!)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!compositeFkReady)("live composite workspace integrity", () => {
  it("rejects an audit row pairing a workspace with another workspace's membership", async () => {
    const serviceClient = createClient(
      integrationConfig.url!,
      integrationConfig.serviceRoleKey!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error } = await serviceClient.from("audit_log").insert({
      workspace_id: integrationConfig.workspaceA!,
      actor_membership_id: integrationConfig.memberBId!,
      actor_kind: "service",
      action: "test.cross_workspace_fk",
      target_type: "test",
      metadata: {},
    });

    expect(error?.code).toBe("23503");
  });
});
