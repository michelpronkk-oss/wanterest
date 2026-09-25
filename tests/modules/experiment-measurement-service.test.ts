import { describe, expect, it } from "vitest";

import type { ActionRow, ExperimentObservationRow, ExperimentRow } from "../../src/server/db/database.helpers";
import type { Json } from "../../src/server/db/database.types";
import { AppError } from "../../src/server/lib/errors";
import type { ActionAccess } from "../../src/server/modules/actions/action-lifecycle.service";
import { authorizeExperimentAccess, currentObservation, ExperimentMeasurementService, type ExperimentAccess, type ExperimentAccessPorts } from "../../src/server/modules/experiments/experiment-measurement.service";
import { buildMeasurementPlan, experimentIdempotencyKey, measurementPlanFingerprint } from "../../src/server/modules/experiments/measurement-plan";
import type { ArmCountRow, MeasurementRepository } from "../../src/server/modules/experiments/measurement.repository";
import { experimentRpcError } from "../../src/server/modules/experiments/measurement.repository";
import { createMeasurementPlanRequestSchema, EXPERIMENT_MEASUREMENT_PASS_LIMIT } from "../../src/server/modules/experiments/measurement.schemas";
import { measurementExperimentRow } from "./experiment.fixtures";

const WS = "c1111111-1111-4111-8111-111111111111";
const WS2 = "c2222222-2222-4222-8222-222222222222";
const USER = "c5555555-5555-4555-8555-555555555555";
const ACTION_ID = "a1111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-25T12:00:00.000Z");

const action = {
  id: ACTION_ID, workspace_id: WS, product_id: "c3333333-3333-4333-8333-333333333333", evidence_node_id: "a2222222-2222-4222-8222-222222222222",
  action_type: "messaging_change", trigger_type: "concept_gap", trigger_concept_key: "pricing", trigger_clustering_version: "demand_clustering_v1",
  proposal_fingerprint: "d".repeat(64), target_key: "homepage_hero", title: "Clarify pricing", status: "approved",
} as unknown as ActionRow;

const beforeAfterPlan = {
  actionId: ACTION_ID, design: "before_after", primaryMetric: "manual_custom", metricLabel: "Qualified demos", metricUnit: "count",
  measurementWindow: "7d", washoutDays: 0, successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 5 }, intervention: "state pricing on the homepage hero",
};

type Call = { fn: string; args: unknown[] };

function fakeRepository(state: { experiment?: ExperimentRow; observations?: ExperimentObservationRow[]; arms?: ArmCountRow[]; due?: ExperimentRow[]; liveSince?: string | null; failFinalizeFor?: string } = {}) {
  const calls: Call[] = [];
  const record = <T>(fn: string, value: T) => (...args: unknown[]) => { calls.push({ fn, args }); return Promise.resolve(value); };
  const repo: MeasurementRepository = {
    createExperiment: record("createExperiment", measurementExperimentRow({ status: "draft" })),
    updateDraft: record("updateDraft", measurementExperimentRow({ status: "draft" })),
    addVariant: record("addVariant", {} as never),
    markReady: record("markReady", measurementExperimentRow({ status: "ready" })),
    cancel: record("cancel", measurementExperimentRow({ status: "canceled" })),
    recordObservation: record("recordObservation", {} as ExperimentObservationRow),
    issueToken: record("issueToken", { id: "t1", public_key: "pk" } as never),
    revokeToken: record("revokeToken", { status: "revoked" } as never),
    armCounts: record("armCounts", state.arms ?? []),
    dueForMeasurement: record("dueForMeasurement", state.due ?? []),
    finalize: (...args: unknown[]) => { calls.push({ fn: "finalize", args }); if (args[1] === state.failFinalizeFor) return Promise.reject(new Error("boom")); return Promise.resolve({ id: "r1" } as never); },
    getExperiment: record("getExperiment", state.experiment ?? null),
    getAction: record("getAction", { ...action, status: "completed" } as ActionRow),
    listObservations: record("listObservations", state.observations ?? []),
    actionLiveSince: record("actionLiveSince", state.liveSince ?? null),
    marketContext: record("marketContext", { evidenceNodeId: "n1", value: 24 }),
    listForProduct: record("listForProduct", []),
  };
  return { repo, calls };
}

function service(repo: MeasurementRepository, enabled: boolean, revalidate: (action: ActionRow) => Promise<Json | null> = async () => ({ gapStateId: "g1" })) {
  return new ExperimentMeasurementService({ repository: repo, measurementEnabled: enabled, revalidateAction: revalidate, now: () => NOW });
}

const actionAccess = (overrides: Partial<ActionAccess> = {}): ActionAccess => ({ userId: USER, action, role: "member", canMutate: true, ...overrides });
const experimentAccess = (experiment: ExperimentRow, canMutate = true): ExperimentAccess => ({ userId: USER, experiment, role: canMutate ? "member" : "viewer", canMutate });

describe("Layer 11 authorization (IDOR fix)", () => {
  const ports = (visible: boolean, membership: { role: string; status: string } | null = { role: "member", status: "active" }, userId: string | null = USER): ExperimentAccessPorts => ({
    currentUser: async () => (userId ? { id: userId } : null),
    loadExperimentAsUser: async () => (visible ? measurementExperimentRow() : null),
    loadMembershipAsUser: async () => membership,
  });
  it("derives scope from the experiment itself; foreign, absent and inactive all read as NOT_FOUND; viewers are read-only", async () => {
    const id = measurementExperimentRow().id;
    await expect(authorizeExperimentAccess(ports(true, undefined, null), id, "read")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(authorizeExperimentAccess(ports(false), id, "read")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeExperimentAccess(ports(true, null), id, "read")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeExperimentAccess(ports(true, { role: "owner", status: "inactive" }), id, "mutate")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeExperimentAccess(ports(true), "not-a-uuid", "read")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeExperimentAccess(ports(true, { role: "viewer", status: "active" }), id, "mutate")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeExperimentAccess(ports(true, { role: "viewer", status: "active" }), id, "read")).resolves.toMatchObject({ canMutate: false });
    for (const role of ["member", "admin", "owner"]) await expect(authorizeExperimentAccess(ports(true, { role, status: "active" }), id, "mutate")).resolves.toMatchObject({ canMutate: true });
  });

  it("browser inputs never carry a workspace, product, fingerprint or idempotency key", () => {
    expect(createMeasurementPlanRequestSchema.safeParse(beforeAfterPlan).success).toBe(true);
    for (const extra of [{ workspaceId: WS2 }, { productId: WS2 }, { idempotencyKey: "x" }, { measurementPlanFingerprint: "f".repeat(64) }]) {
      expect(createMeasurementPlanRequestSchema.safeParse({ ...beforeAfterPlan, ...extra }).success).toBe(false);
    }
  });

  it("maps RPC errors to stable application errors without leaking provider detail", () => {
    expect(experimentRpcError({ message: "experiment_token_not_found" }, "x")).toMatchObject({ code: "NOT_FOUND" });
    expect(experimentRpcError({ message: "experiment_actor_forbidden" }, "x")).toMatchObject({ code: "FORBIDDEN" });
    expect(experimentRpcError({ message: "usage_limit_exceeded" }, "x")).toMatchObject({ code: "USAGE_LIMIT_EXCEEDED", status: 429 });
    expect(experimentRpcError({ code: "23505", message: "duplicate key value violates experiments_one_non_terminal_per_action" }, "x")).toMatchObject({ code: "CONFLICT", details: { reason: "experiment_exists_for_action" } });
    expect(experimentRpcError({ message: "experiment_pause_not_supported" }, "x")).toMatchObject({ code: "VALIDATION_ERROR" });
    const internal = experimentRpcError({ message: "relation secret_table does not exist" }, "Fallback.");
    expect(internal).toMatchObject({ code: "INTERNAL_ERROR", message: "Fallback." });
    expect(JSON.stringify(internal.details ?? {})).not.toContain("secret_table");
  });
});

describe("Layer 11 creation", () => {
  it("creates only from an approved Action after Layer 10 revalidation, with a server-derived plan identity", async () => {
    const { repo, calls } = fakeRepository();
    const revalidated: string[] = [];
    await service(repo, true, async (row) => { revalidated.push(row.id); return { gapStateId: "g1" }; }).createFromAction(actionAccess(), beforeAfterPlan);
    expect(revalidated).toEqual([ACTION_ID]);
    const [payload, actor, guard] = calls.find((call) => call.fn === "createExperiment")!.args as [Record<string, Json>, string, Json];
    const built = buildMeasurementPlan(action, "before_after", beforeAfterPlan as never);
    expect(payload).toMatchObject({ workspace_id: WS, product_id: action.product_id, action_id: ACTION_ID, evidence_design: "before_after", metric_source: "manual", treatment_proposal_fingerprint: "d".repeat(64), measurement_plan_fingerprint: built.planFingerprint });
    expect(payload.idempotency_key).toBe(experimentIdempotencyKey(ACTION_ID, built.planFingerprint));
    expect(payload.idempotency_key).toMatch(/^experiment:a1111111-1111-4111-8111-111111111111:[0-9a-f]{64}$/);
    expect(payload.hypothesis).toContain("Qualified demos");
    expect((payload.hypothesis_structured as Record<string, unknown>).hypothesisVersion).toBe("experiment_hypothesis_v1");
    expect(actor).toBe(USER);
    expect(guard).toEqual({ gapStateId: "g1" });
  });

  it("rejects non-approved Actions, viewers, mismatched ids and revalidation failures before any write", async () => {
    for (const status of ["proposed", "in_progress", "completed", "dismissed", "superseded", "expired"]) {
      const { repo, calls } = fakeRepository();
      await expect(service(repo, true).createFromAction(actionAccess({ action: { ...action, status } as ActionRow }), beforeAfterPlan)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(calls.some((call) => call.fn === "createExperiment")).toBe(false);
    }
    const { repo, calls } = fakeRepository();
    await expect(service(repo, true).createFromAction(actionAccess({ canMutate: false, role: "viewer" }), beforeAfterPlan)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service(repo, true).createFromAction(actionAccess(), { ...beforeAfterPlan, actionId: "a9999999-9999-4999-8999-999999999999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service(repo, true, async () => { throw new AppError("CONFLICT", "A newer recommendation replaces this one.", 409, { reason: "newer_recommendation" }); }).createFromAction(actionAccess(), beforeAfterPlan)).rejects.toMatchObject({ details: { reason: "newer_recommendation" } });
    expect(calls.some((call) => call.fn === "createExperiment")).toBe(false);
  });

  it("requires human-supplied success criteria (no system defaults) and design-consistent metrics", () => {
    const parse = (patch: object) => createMeasurementPlanRequestSchema.safeParse({ ...beforeAfterPlan, ...patch }).success;
    expect(parse({ successCriterion: { direction: "increase", measure: "absolute_delta" } })).toBe(false);
    expect(parse({ successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0 } })).toBe(false);
    expect(parse({ metricLabel: undefined })).toBe(false);
    expect(parse({ design: "controlled_split", primaryMetric: "signup_completed", metricLabel: undefined, metricUnit: undefined, targetPagePath: "/", targetKey: "hero", successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.05 } })).toBe(false);
    expect(parse({ design: "controlled_split", primaryMetric: "signup_completed", metricLabel: undefined, metricUnit: undefined, targetPagePath: "/", targetKey: "hero", successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.05, minSamplePerArm: 100 } })).toBe(true);
    expect(parse({ design: "controlled_split", primaryMetric: "manual_custom", targetPagePath: "/", targetKey: "hero", successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.05, minSamplePerArm: 100 } })).toBe(false);
    expect(parse({ primaryMetric: "signup_completed" })).toBe(false); // label/unit only for manual_custom
    expect(parse({ measurementWindow: "14d" })).toBe(false);
    expect(parse({ washoutDays: 15 })).toBe(false);
  });

  it("the plan fingerprint covers every frozen field and the treated proposal", () => {
    const base = measurementPlanFingerprint(action, "before_after", beforeAfterPlan as never);
    expect(measurementPlanFingerprint(action, "before_after", beforeAfterPlan as never)).toBe(base);
    expect(measurementPlanFingerprint(action, "before_after", { ...beforeAfterPlan, washoutDays: 1 } as never)).not.toBe(base);
    expect(measurementPlanFingerprint(action, "before_after", { ...beforeAfterPlan, successCriterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 6 } } as never)).not.toBe(base);
    expect(measurementPlanFingerprint({ ...action, proposal_fingerprint: "e".repeat(64) }, "before_after", beforeAfterPlan as never)).not.toBe(base);
    expect(measurementPlanFingerprint(action, "controlled_split", beforeAfterPlan as never)).not.toBe(base);
  });
});

describe("EXPERIMENT_MEASUREMENT_ENABLED blocks only new work, never draining", () => {
  it("off: create, draft edits, variants, ready and baseline entry are refused with no write", async () => {
    const draft = measurementExperimentRow({ status: "draft", measurement_start: null, measurement_end: null, treatment_started_at: null, started_at: null });
    const { repo, calls } = fakeRepository();
    const svc = service(repo, false);
    await expect(svc.createFromAction(actionAccess(), beforeAfterPlan)).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(svc.updateDraft(experimentAccess(draft), { experimentId: draft.id, plan: { ...beforeAfterPlan, actionId: undefined, design: undefined } })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(svc.addVariant(experimentAccess(draft), { experimentId: draft.id, variantKey: "control", label: "Control", content: {}, allocationWeight: 5000, isControl: true })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(svc.markReady(experimentAccess(draft))).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(svc.recordManualObservation(experimentAccess(draft), { experimentId: draft.id, windowRole: "baseline", value: 10 })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(svc.issueToken(experimentAccess(measurementExperimentRow({ status: "ready", evidence_design: "controlled_split" })))).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    expect(calls).toEqual([]);
  });

  it("off: cancel, the measurement value, token revoke/issue for a running split and the pass still work", async () => {
    const running = measurementExperimentRow();
    const { repo, calls } = fakeRepository({ due: [running], observations: [] });
    const svc = service(repo, false);
    await svc.cancel(experimentAccess(running), { experimentId: running.id });
    await svc.recordManualObservation(experimentAccess(running), { experimentId: running.id, windowRole: "measurement", value: 18 });
    await svc.revokeToken(experimentAccess(running), { experimentId: running.id, tokenId: "b1111111-1111-4111-8111-111111111111" });
    await svc.issueToken(experimentAccess(measurementExperimentRow({ evidence_design: "controlled_split" })));
    const pass = await svc.runMeasurementPass();
    expect(pass).toMatchObject({ due: 1, finalized: 1, failed: 0 });
    expect(calls.map((call) => call.fn)).toEqual(expect.arrayContaining(["cancel", "recordObservation", "revokeToken", "issueToken", "finalize"]));
    // The measurement value uses the frozen window, never a browser-supplied period.
    const observation = calls.find((call) => call.fn === "recordObservation")!.args[0] as Record<string, unknown>;
    expect(observation).toMatchObject({ window_role: "measurement", period_start: running.measurement_start, period_end: running.measurement_end, source: "manual" });
  });

  it("on: the baseline value covers the L days ending at today's UTC day boundary", async () => {
    const draft = measurementExperimentRow({ status: "draft" });
    const { repo, calls } = fakeRepository();
    await service(repo, true).recordManualObservation(experimentAccess(draft), { experimentId: draft.id, windowRole: "baseline", value: 10 });
    const observation = calls[0]!.args[0] as Record<string, unknown>;
    expect(observation).toMatchObject({ period_start: "2026-09-18T00:00:00.000Z", period_end: "2026-09-25T00:00:00.000Z", window_role: "baseline" });
    expect(calls[0]!.args.slice(1)).toEqual(["user", USER]);
  });

  it("controlled splits take no manual values; legacy rows are refused by every v1 command", async () => {
    const { repo } = fakeRepository();
    const svc = service(repo, true);
    const controlled = measurementExperimentRow({ evidence_design: "controlled_split" });
    await expect(svc.recordManualObservation(experimentAccess(controlled), { experimentId: controlled.id, windowRole: "measurement", value: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const legacy = measurementExperimentRow({ measurement_policy_version: null });
    await expect(svc.markReady(experimentAccess(legacy))).rejects.toMatchObject({ details: { reason: "legacy_experiment" } });
    await expect(svc.cancel(experimentAccess(legacy), { experimentId: legacy.id })).rejects.toMatchObject({ details: { reason: "legacy_experiment" } });
  });
});

describe("measurement pass", () => {
  it("is bounded to 50, isolates failures, records one system context snapshot, and finalizes with the used observations", async () => {
    const ok = measurementExperimentRow();
    const bad = measurementExperimentRow({ id: "e9999999-9999-4999-8999-999999999999" });
    const observations = [
      { id: "o1", source: "manual", window_role: "baseline", period_start: ok.baseline_start, period_end: ok.baseline_end, value: 10, denominator: null, supersedes_observation_id: null, recorded_at: "2026-09-05T09:00:00.000Z" },
      { id: "o2", source: "manual", window_role: "baseline", period_start: ok.baseline_start, period_end: ok.baseline_end, value: 11, denominator: null, supersedes_observation_id: "o1", recorded_at: "2026-09-05T09:30:00.000Z" },
      { id: "o3", source: "manual", window_role: "measurement", period_start: ok.measurement_start, period_end: ok.measurement_end, value: 18, denominator: null, supersedes_observation_id: null, recorded_at: "2026-09-18T09:00:00.000Z" },
    ] as unknown as ExperimentObservationRow[];
    const { repo, calls } = fakeRepository({ due: [ok, bad], observations, liveSince: "2026-09-10T00:00:00.000Z", failFinalizeFor: bad.id });
    const result = await service(repo, false).runMeasurementPass(500);
    expect(result).toMatchObject({ due: 2, finalized: 1, failed: 1, outcomes: { positive: 1 } });
    expect((calls.find((call) => call.fn === "dueForMeasurement")!.args[1] as number)).toBeLessThanOrEqual(EXPERIMENT_MEASUREMENT_PASS_LIMIT);
    const context = calls.filter((call) => call.fn === "recordObservation");
    expect(context).toHaveLength(2);
    expect(context[0]!.args).toEqual([expect.objectContaining({ metric_key: "market_evidence_count", source: "wanterest_internal", idempotency_key: `context:${ok.id}:measurement`, source_ref: { evidenceNodeId: "n1" } }), "system", null]);
    const [workspaceId, experimentId, payload, close, observationIds] = calls.find((call) => call.fn === "finalize")!.args as [string, string, Record<string, unknown>, boolean, string[]];
    expect([workspaceId, experimentId, close]).toEqual([ok.workspace_id, ok.id, true]);
    expect(observationIds).toEqual(["o2", "o3"]); // the correction supersedes o1
    expect(payload).toMatchObject({ outcome: "positive", attribution_class: "before_after_association", treatment_integrity: "confirmed", baseline_value: 11, observed_value: 18, effect: 7 });
    expect(payload.input_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canceled-after-treatment experiments get a result without closing again; controlled splits read SQL arm counts", async () => {
    const abandoned = measurementExperimentRow({ status: "canceled", closed_reason: "treatment_abandoned", invalidation_reason: "treatment_abandoned" });
    const split = measurementExperimentRow({ id: "e3333333-3333-4333-8333-333333333333", evidence_design: "controlled_split", primary_metric: "signup_completed", metric_label: null, metric_unit: null, success_criterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 0.05, minSamplePerArm: 100 } as Json });
    const arms: ArmCountRow[] = [
      { variant_id: "c", is_control: true, exposed: 200, converted: 20, excluded_events: 1, days_with_exposure: 7, window_days: 7 },
      { variant_id: "t", is_control: false, exposed: 200, converted: 40, excluded_events: 0, days_with_exposure: 7, window_days: 7 },
    ];
    const { repo, calls } = fakeRepository({ due: [abandoned, split], arms });
    await service(repo, false).runMeasurementPass();
    const finals = calls.filter((call) => call.fn === "finalize");
    expect(finals[0]!.args[2]).toMatchObject({ outcome: "invalid", invalidation_reason: "treatment_abandoned" });
    expect(finals[0]!.args[3]).toBe(false);
    expect(finals[1]!.args[2]).toMatchObject({ outcome: "positive", attribution_class: "controlled_comparison", treatment_integrity: "verified_exposure" });
    expect(String((finals[1]!.args[2] as Record<string, unknown>).summary)).toContain("Not statistically tested.");
    expect(calls.filter((call) => call.fn === "armCounts")).toHaveLength(1);
  });

  it("the current observation ignores superseded rows, other windows and internal context", () => {
    const rows = [
      { id: "a", source: "manual", window_role: "baseline", period_start: "2026-01-01T00:00:00.000Z", period_end: "2026-01-08T00:00:00.000Z", supersedes_observation_id: null, recorded_at: "1" },
      { id: "b", source: "manual", window_role: "baseline", period_start: "2026-01-01T00:00:00.000Z", period_end: "2026-01-08T00:00:00.000Z", supersedes_observation_id: "a", recorded_at: "2" },
      { id: "c", source: "wanterest_internal", window_role: "baseline", period_start: "2026-01-01T00:00:00.000Z", period_end: "2026-01-08T00:00:00.000Z", supersedes_observation_id: null, recorded_at: "3" },
      { id: "d", source: "manual", window_role: "baseline", period_start: "2025-12-01T00:00:00.000Z", period_end: "2025-12-08T00:00:00.000Z", supersedes_observation_id: null, recorded_at: "4" },
    ] as unknown as ExperimentObservationRow[];
    expect(currentObservation(rows, "baseline", "2026-01-01T00:00:00+00:00", "2026-01-08T00:00:00+00:00")?.id).toBe("b");
    expect(currentObservation(rows, "measurement", "2026-01-01T00:00:00.000Z", "2026-01-08T00:00:00.000Z")).toBeNull();
    expect(currentObservation(rows, "baseline", null, null)).toBeNull();
  });
});
