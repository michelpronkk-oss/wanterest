import type { ExperimentInsert, ExperimentRow } from "../../src/server/db/database.helpers";

/** A legacy Phase 7 experiment row (no measurement policy), seeded directly for legacy-path tests. */
export function legacyExperimentRow(input: { workspaceId: string; productId: string; actionId: string; name: string; targetKey: string; createdBy?: string }): ExperimentInsert {
  return {
    id: crypto.randomUUID(), workspace_id: input.workspaceId, product_id: input.productId, action_id: input.actionId, evidence_node_id: crypto.randomUUID(),
    experiment_type: "landing_page_test", name: input.name, hypothesis: "The treatment changes signups", primary_metric: "signup_completed", status: "draft",
    traffic_allocation: {}, target_page_path: "/", target_key: input.targetKey, assignment_method: "deterministic_hash_v1", min_sample_size: 1,
    created_by: input.createdBy ?? "44444444-4444-4444-8444-444444444444", engine_version_id: null, current_result_id: null, started_at: null, ended_at: null,
  };
}

/** A running measurement-v1 experiment row for service/event tests. */
export function measurementExperimentRow(overrides: Partial<ExperimentRow> = {}): ExperimentRow {
  const start = "2026-09-10T00:00:00.000Z";
  return {
    id: "e1111111-1111-4111-8111-111111111111", workspace_id: "c1111111-1111-4111-8111-111111111111", product_id: "c3333333-3333-4333-8333-333333333333",
    action_id: "a1111111-1111-4111-8111-111111111111", evidence_node_id: "e2222222-2222-4222-8222-222222222222", experiment_type: "messaging_test",
    name: "Measure", hypothesis: "If we change the hero, qualified demos increase.", primary_metric: "manual_custom", status: "running",
    traffic_allocation: {}, target_page_path: null, target_key: null, assignment_method: "deterministic_hash_v1", min_sample_size: 1,
    created_by: "c5555555-5555-4555-8555-555555555555", engine_version_id: null, current_result_id: null, started_at: start, ended_at: null,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
    measurement_policy_version: "experiment_measurement_v1", evidence_design: "before_after", metric_source: "manual", metric_label: "Qualified demos",
    metric_unit: "count", measurement_window: "7d", washout_days: 0,
    success_criterion: { direction: "increase", measure: "absolute_delta", minimumEffect: 5 }, hypothesis_structured: { hypothesisVersion: "experiment_hypothesis_v1" },
    treatment_proposal_fingerprint: "d".repeat(64), measurement_plan_fingerprint: "f".repeat(64), idempotency_key: `experiment:a1111111-1111-4111-8111-111111111111:${"f".repeat(64)}`,
    registered_at: "2026-09-05T10:00:00.000Z", baseline_start: "2026-08-29T00:00:00.000Z", baseline_end: "2026-09-05T00:00:00.000Z",
    treatment_started_at: start, measurement_start: start, measurement_end: "2026-09-17T00:00:00.000Z", closed_reason: null, invalidation_reason: null,
    ...overrides,
  } as ExperimentRow;
}
