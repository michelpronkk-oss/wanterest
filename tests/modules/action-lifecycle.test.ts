import { describe, expect, it } from "vitest";

import type { ActionRow } from "../../src/server/db/database.helpers";
import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { actionTransitionRequestSchema } from "../../src/server/modules/actions/action.schemas";
import { ActionLifecycleService, authorizeActionAccess, type ActionAccessPorts } from "../../src/server/modules/actions/action-lifecycle.service";
import { Harness, NOW, RISING_STRONG, USER, VIEWER, WS, WS2 } from "./concept-action.harness";

const OTHER_USER = "c8888888-8888-4888-8888-888888888888";

async function proposed(h: Harness, anchor = "pricing", opts: Parameters<Harness["concept"]>[1] = {}) {
  await h.concept(anchor, opts);
  await h.run();
  return h.openActions().find((row) => row.trigger_concept_key === anchor)!;
}

function ports(h: Harness, userId: string | null, visible = true, membership: { role: string; status: string } | null = { role: "member", status: "active" }): ActionAccessPorts {
  return {
    currentUser: async () => (userId ? { id: userId } : null),
    loadActionAsUser: async (id) => (visible ? h.actions.actions.get(id) ?? null : null),
    loadMembershipAsUser: async () => membership,
  };
}

describe("Layer 10 authorization (service-role IDOR fix)", () => {
  it("resolves scope from the Action itself; non-member, cross-tenant and inactive all read as NOT_FOUND", async () => {
    const h = new Harness();
    const action = await proposed(h);
    await expect(authorizeActionAccess(ports(h, null), action.id, "read")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(authorizeActionAccess(ports(h, OTHER_USER, false), action.id, "read")).rejects.toMatchObject({ code: "NOT_FOUND" }); // RLS hides another tenant's row
    await expect(authorizeActionAccess(ports(h, OTHER_USER, true, null), action.id, "read")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeActionAccess(ports(h, OTHER_USER, true, { role: "owner", status: "inactive" }), action.id, "mutate")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeActionAccess(ports(h, USER), "not-a-uuid", "read")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeActionAccess(ports(h, USER), "d0000000-0000-4000-8000-000000000000", "read")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const access = await authorizeActionAccess(ports(h, USER), action.id, "mutate");
    expect(access.action.workspace_id).toBe(WS);
  });

  it("viewer may read but not mutate; member/admin/owner may mutate", async () => {
    const h = new Harness();
    const action = await proposed(h);
    await expect(authorizeActionAccess(ports(h, VIEWER, true, { role: "viewer", status: "active" }), action.id, "read")).resolves.toMatchObject({ canMutate: false });
    await expect(authorizeActionAccess(ports(h, VIEWER, true, { role: "viewer", status: "active" }), action.id, "mutate")).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ["member", "admin", "owner"]) await expect(authorizeActionAccess(ports(h, USER, true, { role, status: "active" }), action.id, "mutate")).resolves.toMatchObject({ canMutate: true });
    // Viewer transitions are rejected again at the service and inside the RPC (defense in depth).
    await expect(h.lifecycle().transition(h.access(action.id, VIEWER), { toStatus: "dismissed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.actionService().transitionAction({ workspaceId: WS, actionId: action.id, toStatus: "dismissed", actorKind: "user", actorUserId: VIEWER })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the browser contract accepts only { actionId, toStatus, note? } — a workspaceId is rejected, never used", () => {
    const actionId = "d0000000-0000-4000-8000-000000000000";
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "approved" }).success).toBe(true);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "completed", note: "Shipped the new hero." }).success).toBe(true);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "approved", workspaceId: WS2 }).success).toBe(false);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "expired" }).success).toBe(false);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "superseded" }).success).toBe(false);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "dismissed", note: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("Layer 10 approve / start revalidation", () => {
  it("approve and start pass only with the plan, a settled candidate and an equal fingerprint; events record manual execution and the audit row", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const approved = await h.lifecycle().transition(h.access(action.id), { toStatus: "approved" });
    expect(approved.status).toBe("approved");
    const started = await h.lifecycle().transition(h.access(action.id), { toStatus: "in_progress" });
    expect(started.status).toBe("in_progress");
    const events = [...h.actions.events.values()].filter((event) => event.action_id === action.id);
    expect(events.find((event) => event.event_type === "approved")).toMatchObject({ actor_kind: "user", actor_user_id: USER, metadata: expect.objectContaining({ executionMode: "manual", approvalPolicy: "human_required_v1", revalidation: expect.objectContaining({ proposalFingerprint: action.proposal_fingerprint }) }) });
    expect(events.find((event) => event.event_type === "started")).toBeTruthy();
    expect(h.actions.auditRows.map((row) => row.action)).toEqual(["action.approved", "action.in_progress"]);
  });

  it("plan gate: approve and start require actions_enabled; complete and dismiss do not", async () => {
    const h = new Harness();
    const action = await proposed(h);
    await h.lifecycle().transition(h.access(action.id), { toStatus: "approved" });
    h.actionsEnabled = false;
    await expect(h.lifecycle().transition(h.access(action.id), { toStatus: "in_progress" })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    h.actionsEnabled = true;
    await h.lifecycle().transition(h.access(action.id), { toStatus: "in_progress" });
    h.actionsEnabled = false;
    const done = await h.lifecycle().transition(h.access(action.id), { toStatus: "completed", note: "Rewrote the pricing section." });
    expect(done.status).toBe("completed");
    expect([...h.actions.events.values()].find((event) => event.event_type === "completed")!.metadata).toMatchObject({ executionMode: "manual", note: "Rewrote the pricing section." });

    const h2 = new Harness();
    const other = await proposed(h2);
    h2.actionsEnabled = false;
    await expect(h2.lifecycle().transition(h2.access(other.id), { toStatus: "approved" })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    expect((await h2.lifecycle().transition(h2.access(other.id), { toStatus: "dismissed" })).status).toBe("dismissed");
  });

  it("pending selection rejects without any write", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const eventsBefore = h.actions.events.size;
    h.live.set("pricing", { ...h.live.get("pricing")!, clusters: [{ ...h.live.get("pricing")!.clusters[0], members: [] }] });
    await expect(h.lifecycle().transition(h.access(action.id), { toStatus: "approved" })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "basis_update_pending:currentness" } });
    expect(h.actions.actions.get(action.id)!.status).toBe("proposed");
    expect(h.actions.events.size).toBe(eventsBefore);
  });

  it("settled with no candidate: the Action is expired by the system, then the approval is rejected", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const market = await h.market("pricing", { evidence: 24, members: h.live.get("pricing")!.clusters[0].members.map((m) => m.membershipId).concat("x") });
    await h.gap(market, { status: "directional", score: null });
    for (const window of ["7d", "30d", "90d"]) await h.drift(market, window);
    await expect(h.lifecycle().transition(h.access(action.id), { toStatus: "approved" })).rejects.toMatchObject({ details: { reason: "basis_invalid" } });
    expect(h.actions.actions.get(action.id)).toMatchObject({ status: "expired" });
    expect([...h.actions.events.values()].find((event) => event.event_type === "expired")).toMatchObject({ actor_kind: "system" });
    expect(h.actions.auditRows).toHaveLength(0);
  });

  it("a newer canonical recommendation (old Drift + new eligible Gap) blocks approve before reconciliation runs", async () => {
    const h = new Harness();
    const drift = await proposed(h, "pricing", { gap: { status: "directional", score: null }, drift: { "7d": RISING_STRONG } });
    const market = await h.market("pricing", { members: h.live.get("pricing")!.clusters[0].members.map((m) => m.membershipId).concat("y") });
    await h.gap(market);
    for (const window of ["7d", "30d", "90d"]) await h.drift(market, window, window === "7d" ? RISING_STRONG : {});
    const live = await h.lifecycle().evaluate([h.actions.actions.get(drift.id)!], { canMutate: true });
    expect(live.get(drift.id)).toMatchObject({ basisStatus: "valid", proposalCurrent: false, allowedTransitions: ["dismissed"] });
    await expect(h.lifecycle().transition(h.access(drift.id), { toStatus: "approved" })).rejects.toMatchObject({ details: { reason: "newer_recommendation" } });
    expect(h.actions.actions.get(drift.id)!.status).toBe("proposed");
  });

  it("basis-guard race: a basis materialized between the selector and the RPC fails with action_basis_changed and no transition", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const staleInputs = await h.service().loadInputs(h.product, NOW);
    const market = await h.states.latestMarketState(WS, h.product.id, DEMAND_CLUSTERING_VERSION, "pricing", "concept_market_state_v1");
    await h.gap(market!); // a new gap row appended concurrently
    const racing = new ActionLifecycleService({ actionService: h.actionService(), actionsEnabled: async () => true, loadProduct: async () => h.product, loadConceptInputs: async () => staleInputs, downstreamIntelligenceV2Enabled: true, now: () => NOW });
    await expect(racing.transition(h.access(action.id), { toStatus: "approved" })).rejects.toMatchObject({ details: { reason: "action_basis_changed" } });
    expect(h.actions.actions.get(action.id)!.status).toBe("proposed");
  });

  it("compare-and-set race: two concurrent approvals of the same Action — exactly one wins", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const access = h.access(action.id);
    const results = await Promise.allSettled([h.lifecycle().transition(access, { toStatus: "approved" }), h.lifecycle().transition(access, { toStatus: "approved" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { details: { reason: "action_status_conflict" } } });
    expect([...h.actions.events.values()].filter((event) => event.event_type === "approved")).toHaveLength(1);
  });

  it("legacy-basis Actions under v2 can be read and dismissed but not approved or started", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const legacy = { ...action, id: "legacy-1", trigger_type: "demand_gap", trigger_clustering_version: null, proposal_fingerprint: null, idempotency_key: "legacy" } as ActionRow;
    h.actions.actions.set(legacy.id, legacy);
    await expect(h.lifecycle().transition(h.access(legacy.id), { toStatus: "approved" })).rejects.toMatchObject({ details: { reason: "legacy_basis_not_verified" } });
    expect((await h.lifecycle().transition(h.access(legacy.id), { toStatus: "dismissed" })).status).toBe("dismissed");
  });

  it("lifecycle matrix: expired is system-only, in_progress can only complete or dismiss, terminal states accept nothing", async () => {
    const h = new Harness();
    const action = await proposed(h);
    await expect(h.actionService().transitionAction({ workspaceId: WS, actionId: action.id, toStatus: "expired", actorKind: "user", actorUserId: USER })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.lifecycle().transition(h.access(action.id), { toStatus: "approved" });
    await h.lifecycle().transition(h.access(action.id), { toStatus: "in_progress" });
    await expect(h.actionService().transitionAction({ workspaceId: WS, actionId: action.id, toStatus: "expired", actorKind: "system" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(h.actionService().transitionAction({ workspaceId: WS, actionId: action.id, toStatus: "superseded", actorKind: "system" })).rejects.toMatchObject({ code: "CONFLICT" });
    await h.lifecycle().transition(h.access(action.id), { toStatus: "completed" });
    await expect(h.lifecycle().transition(h.access(action.id), { toStatus: "dismissed" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Layer 10 live read model", () => {
  it("list/detail parity, batched: one live roll-up for many Actions and zero writes", async () => {
    const h = new Harness();
    for (const key of ["pricing", "api_access", "reporting"]) await h.concept(key);
    await h.run();
    const rows = h.openActions();
    const snapshotBefore = JSON.stringify({ actions: [...h.actions.actions.values()], events: [...h.actions.events.values()], provenance: h.actions.provenance, usage: [...h.actions.consumedUsage] });
    h.liveReads = 0;
    const list = await h.lifecycle().evaluate(rows, { canMutate: true });
    expect(h.liveReads).toBe(1); // no per-Action N+1
    for (const row of rows) {
      const detail = await h.lifecycle().evaluate([row], { canMutate: true });
      expect(detail.get(row.id)).toEqual(list.get(row.id));
      expect(list.get(row.id)).toMatchObject({ basisStatus: "valid", proposalCurrent: true, allowedTransitions: ["approved", "dismissed"], executionMode: "manual" });
    }
    expect(JSON.stringify({ actions: [...h.actions.actions.values()], events: [...h.actions.events.values()], provenance: h.actions.provenance, usage: [...h.actions.consumedUsage] })).toBe(snapshotBefore);
  });

  it("page reads never expire: an invalid proposed Action reads invalid and stays proposed until the write-side pass", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const market = await h.market("pricing", { members: h.live.get("pricing")!.clusters[0].members.map((m) => m.membershipId).concat("z") });
    await h.gap(market, { status: "directional", score: null });
    for (const window of ["7d", "30d", "90d"]) await h.drift(market, window);
    const live = await h.lifecycle().evaluate([h.actions.actions.get(action.id)!], { canMutate: true });
    expect(live.get(action.id)).toMatchObject({ basisStatus: "invalid", allowedTransitions: ["dismissed"] });
    expect(h.actions.actions.get(action.id)!.status).toBe("proposed");
  });

  it("viewers see basis status but no transitions", async () => {
    const h = new Harness();
    const action = await proposed(h);
    const live = await h.lifecycle().evaluate([action], { canMutate: false });
    expect(live.get(action.id)).toMatchObject({ basisStatus: "valid", allowedTransitions: [] });
  });
});
