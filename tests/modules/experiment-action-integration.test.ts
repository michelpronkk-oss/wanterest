import { describe, expect, it } from "vitest";

import { actionRpcError, type AtomicActionTransition } from "../../src/server/modules/actions/action.repository";
import { actionTransitionRequestSchema } from "../../src/server/modules/actions/action.schemas";
import { ActionLifecycleService } from "../../src/server/modules/actions/action-lifecycle.service";
import { Harness, NOW } from "./concept-action.harness";

/**
 * Layer 11 ↔ Layer 10: one canonical start path. The app passes
 * EXPERIMENT_MEASUREMENT_ENABLED to transition_action as
 * p_experiment_starts_allowed (default closed); completion carries liveSince.
 */

function lifecycle(h: Harness, experimentMeasurementEnabled: boolean | undefined) {
  const service = h.service();
  return new ActionLifecycleService({
    actionService: h.actionService(),
    actionsEnabled: async () => h.actionsEnabled,
    loadProduct: async () => h.product,
    loadConceptInputs: (product, now) => service.loadInputs(product, now),
    downstreamIntelligenceV2Enabled: true,
    ...(experimentMeasurementEnabled === undefined ? {} : { experimentMeasurementEnabled }),
    now: () => NOW,
  });
}

function capture(h: Harness): AtomicActionTransition[] {
  const calls: AtomicActionTransition[] = [];
  const original = h.actions.transitionActionAtomic.bind(h.actions);
  h.actions.transitionActionAtomic = async (input) => { calls.push(input); return original(input); };
  return calls;
}

async function approvedAction(h: Harness, anchor: string) {
  await h.concept(anchor);
  await h.run();
  const action = h.openActions().find((row) => row.trigger_concept_key === anchor)!;
  await lifecycle(h, false).transition(h.access(action.id), { toStatus: "approved" });
  return action;
}

describe("Layer 11 hook in the Layer 10 start path", () => {
  it("passes experimentStartsAllowed only for approved → in_progress and only when the flag is on", async () => {
    const h = new Harness();
    const on = await approvedAction(h, "pricing");
    const calls = capture(h);
    await lifecycle(h, true).transition(h.access(on.id), { toStatus: "in_progress" });
    expect(calls.at(-1)).toMatchObject({ from: "approved", to: "in_progress", experimentStartsAllowed: true });

    const off = await approvedAction(h, "reporting");
    await lifecycle(h, false).transition(h.access(off.id), { toStatus: "in_progress" });
    expect(calls.at(-1)?.experimentStartsAllowed).toBeUndefined();

    const unset = await approvedAction(h, "api_access");
    await lifecycle(h, undefined).transition(h.access(unset.id), { toStatus: "in_progress" });
    expect(calls.at(-1)?.experimentStartsAllowed).toBeUndefined(); // default closed

    await lifecycle(h, true).transition(h.access(on.id), { toStatus: "completed" });
    expect(calls.at(-1)?.experimentStartsAllowed).toBeUndefined();
  });

  it("completion metadata carries the normalized go-live date; the browser contract accepts only a real timestamp", async () => {
    const h = new Harness();
    const action = await approvedAction(h, "pricing");
    await lifecycle(h, true).transition(h.access(action.id), { toStatus: "in_progress" });
    const calls = capture(h);
    await lifecycle(h, true).transition(h.access(action.id), { toStatus: "completed", liveSince: "2026-09-25T13:30:00+01:00" });
    expect(calls.at(-1)?.metadata).toMatchObject({ liveSince: "2026-09-25T12:30:00.000Z", executionMode: "manual" });
    const actionId = "d0000000-0000-4000-8000-000000000000";
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "completed", liveSince: "2026-09-25T12:00:00.000Z" }).success).toBe(true);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "completed", liveSince: "yesterday" }).success).toBe(false);
    expect(actionTransitionRequestSchema.safeParse({ actionId, toStatus: "completed", liveSince: "2026-09-25T12:00:00.000Z", workspaceId: "c2222222-2222-4222-8222-222222222222" }).success).toBe(false);
  });

  it("maps the database treatment-integrity and experiment-conflict errors to stable application errors", () => {
    expect(actionRpcError({ message: "treatment_live_since_required" }, "x")).toMatchObject({ code: "VALIDATION_ERROR", details: { reason: "treatment_live_since_required" } });
    expect(actionRpcError({ message: "treatment_live_since_invalid" }, "x")).toMatchObject({ code: "VALIDATION_ERROR", details: { reason: "treatment_live_since_invalid" } });
    expect(actionRpcError({ message: "experiment_state_conflict" }, "x")).toMatchObject({ code: "CONFLICT", details: { reason: "experiment_state_conflict" } });
  });

  it("measurement revalidation is read-only: it never expires the Action and requires a current proposal", async () => {
    const h = new Harness();
    const action = await approvedAction(h, "pricing");
    await expect(lifecycle(h, true).revalidateForMeasurement(h.actions.actions.get(action.id)!)).resolves.toMatchObject({ gapStateId: expect.any(String) });
    await expect(lifecycle(h, true).revalidateForMeasurement({ ...h.actions.actions.get(action.id)!, proposal_fingerprint: "0".repeat(64) })).rejects.toMatchObject({ details: { reason: "newer_recommendation" } });
    h.actionsEnabled = false;
    await expect(lifecycle(h, true).revalidateForMeasurement(h.actions.actions.get(action.id)!)).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    expect(h.actions.actions.get(action.id)!.status).toBe("approved");
    await expect(lifecycle(h, true).revalidateForMeasurement({ ...h.actions.actions.get(action.id)!, trigger_type: "demand_gap" })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    h.actionsEnabled = true;
    await expect(lifecycle(h, true).revalidateForMeasurement({ ...h.actions.actions.get(action.id)!, trigger_type: "demand_gap" })).rejects.toMatchObject({ details: { reason: "legacy_basis_not_verified" } });
  });
});
