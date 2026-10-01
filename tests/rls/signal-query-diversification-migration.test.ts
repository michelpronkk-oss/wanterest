import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261107000000_signal_query_diversification_v1.sql"), "utf8").toLowerCase();
const v11Sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261109000000_signal_query_exploration_v11.sql"), "utf8").toLowerCase();

describe("Signal Throughput V1 migration contract", () => {
  it("is the next forward migration and only adds private telemetry dimensions", () => {
    const files = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261107000000_signal_query_diversification_v1.sql"), "utf8");
    expect(files).toContain("Signal Throughput V1");
    expect(sql).toContain("alter table public.source_query_executions");
    expect(sql).toContain("add column intent_family text not null default 'unclassified'");
    expect(sql).toContain("add column query_variant_version text not null default 'legacy'");
    expect(sql).toContain("alter table public.product_query_result_outcomes");
    expect(sql).toContain("add column evidence_eligible boolean");
    expect(sql).not.toMatch(/\b(drop table|delete from|truncate)\b/);
    expect(sql).not.toMatch(/\b(raw_content|author_name|author_id|query_text|cursor_value|payload_json)\b/);
  });

  it("bounds and scopes query history while retaining roots, evidence, evaluation and lifecycle measures", () => {
    expect(sql).toContain("scan_rank <= least(greatest(coalesce(p_max_scans, 12), 1), 30)");
    expect(sql).toContain("limit 1000");
    expect(sql).toContain("raw_snapshots_inserted integer");
    expect(sql).toContain("unique_provider_items integer");
    expect(sql).toContain("normalized_items integer");
    expect(sql).toContain("raw_snapshots_duplicate integer");
    expect(sql).toContain("attributable_results integer");
    expect(sql).toContain("independent_roots integer");
    expect(sql).toContain("count(a.id)::integer as attributable_results");
    expect(sql).toContain("query_yield_artifacts_product_history_idx");
    expect(sql).toContain("new_independent_qualified_roots integer");
    expect(sql).toContain("ar.scan_root_owner_rank = 1 and ar.qualified is true");
    expect(sql).toContain("count(*) over () > 1000 as history_truncated");
    expect(sql).toContain("greatest(coalesce(p_since, now() - interval '90 days'), now() - interval '90 days')");
    expect(sql).toContain("previous_attribution.conversation_id = qr.conversation_id");
    const priorRootCheck = sql.slice(sql.indexOf("exists ("), sql.indexOf(") as was_known_before_scan"));
    expect(priorRootCheck).toContain("previous_artifact.workspace_id = qr.workspace_id");
    expect(priorRootCheck).toContain("previous_artifact.product_id = qr.product_id");
    expect(priorRootCheck).toContain("previous_job.created_at >= now() - interval '90 days'");
    expect(priorRootCheck).toContain("previous_artifact.created_at >= now() - interval '90 days'");
    expect(priorRootCheck).not.toContain("previous_execution.source_key = previous_artifact.source_key");
    expect(priorRootCheck).not.toContain("previous_execution.query_plan_fingerprint");
    expect(sql).toContain("partition by qr.workspace_id, qr.product_id, qr.scan_job_run_id, qr.conversation_id");
    expect(sql).toContain("new_root_attributions");
    expect(sql).toContain("new_independent_roots");
    expect(sql).toContain("duplicate_root_attributions");
    expect(sql).toContain("evidence_eligible_roots");
    expect(sql).toContain("evaluated_roots");
    expect(sql).toContain("qualified_roots");
    expect(sql).toContain("signal_roots");
  });

  it("keeps the aggregate RPC service-role-only with a safe invoker context", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/\bsecurity definer\b/);
    expect(sql).not.toMatch(/grant\s+[^;]*\bon\s+table\s+public\.(source_query_executions|product_query_result_outcomes)\s+to\s+(public|anon|authenticated)/);
  });
});

describe("Signal Throughput V1.1 migration contract", () => {
  it("is additive after 20261108000000 and stores bounded reasons/states only", () => {
    const migrationDir = path.resolve(process.cwd(), "supabase/migrations");
    const migrationNames = readFileSync(path.resolve(migrationDir, "20261109000000_signal_query_exploration_v11.sql"), "utf8");
    expect(migrationNames).toContain("Signal Throughput V1.1");
    expect(v11Sql).toContain("add column selection_reason text");
    expect(v11Sql).toContain("add column novelty_state text");
    expect(v11Sql).toContain("signal_query_exploration_v1_1");
    expect(v11Sql).toContain("new_independent_evidence_eligible_roots integer");
    expect(v11Sql).toContain("count(ar.conversation_id) filter (");
    expect(v11Sql).toContain("ar.scan_root_owner_rank = 1 and not ar.was_known_before_scan and ar.evidence_eligible is true");
    expect(v11Sql).toContain("drop function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(v11Sql).toContain("'cold_start_exploration'");
    expect(v11Sql).toContain("'unseen_variant_exploration'");
    expect(v11Sql).toContain("'recency_rotation'");
    expect(v11Sql).toContain("to service_role");
    expect(v11Sql).not.toMatch(/\b(drop table|delete from|truncate)\b/);
    expect(v11Sql).not.toMatch(/\b(raw_content|author_name|author_id|query_text|cursor_value|payload_json)\b/);
  });

  it("preserves service-only invoker history permissions and empty search path", () => {
    expect(v11Sql).toContain("security invoker");
    expect(v11Sql).toContain("set search_path = ''");
    expect(v11Sql).toContain("revoke all on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(v11Sql).toContain("from public, anon, authenticated");
    expect(v11Sql).toContain("grant execute on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)");
    expect(v11Sql).not.toMatch(/\bsecurity definer\b/);
    expect(v11Sql).not.toMatch(/grant\s+[^;]*\bon\s+table\s+public\.(source_query_executions|product_query_result_outcomes)\s+to\s+(public|anon|authenticated)/);
  });
});

describe("Signal Throughput V1 wiring boundaries", () => {
  const scan = readFileSync(path.resolve(process.cwd(), "src/server/modules/onboarding/initial-scan.service.ts"), "utf8");
  const execution = readFileSync(path.resolve(process.cwd(), "src/server/modules/operations/query-planning.execution.ts"), "utf8");
  const telemetry = readFileSync(path.resolve(process.cwd(), "src/server/modules/operations/source-execution-telemetry.repository.ts"), "utf8");
  const admin = readFileSync(path.resolve(process.cwd(), "apps/admin/src/server/operations.ts"), "utf8");
  const plannerService = readFileSync(path.resolve(process.cwd(), "src/server/modules/operations/signal-query-diversification.service.ts"), "utf8");

  it("gates the planner treatment behind the exact server-side flag and leaves selection/backlog semantics separate", () => {
    expect(scan).toContain("signalQueryDiversificationEnabled()");
    expect(scan).toContain("signalQueryExplorationV11Enabled()");
    expect(scan).toContain("buildSignalDiversifiedQueryPlan");
    expect(scan).toContain("enqueueCapSuppressed");
    expect(scan).not.toContain("SIGNAL_QUERY_DIVERSIFICATION_V1_ENABLED=true");
  });

  it("keeps V1's selected plan unchanged when V1.1 is disabled or history is unavailable", () => {
    expect(plannerService).toContain("const v1 = diversifySignalQueries({ ...args, historyState: input.historyState });");
    expect(plannerService).toContain("if (input.explorationV11Enabled && input.historyState === \"available\")");
    expect(plannerService).toContain("return v1;");
    expect(plannerService).not.toContain("NEXT_PUBLIC_SIGNAL_QUERY_EXPLORATION_V11_ENABLED");
  });

  it("records typed dimensions and evidence eligibility without exposing fingerprints in the Admin view", () => {
    expect(execution).toContain("intentFamily: query.intent_family");
    expect(execution).toContain("queryVariantVersion: query.query_variant_version");
    expect(telemetry).toContain("intent_family: input.intentFamily");
    expect(telemetry).toContain("query_variant_version: input.queryVariantVersion");
    expect(telemetry).toContain("selection_reason: input.selectionReason");
    expect(telemetry).toContain("novelty_state: input.noveltyState");
    expect(telemetry).toContain("evidence_eligible: row.evidenceEligible ?? null");
    expect(admin).toContain("signal_query_novelty_history");
    expect(admin).not.toContain("query_plan_fingerprint");
    expect(admin).not.toContain("query_text");
    expect(admin).toContain("signalQueryExplorationV11");
    expect(admin).toContain("exploration:input_reference->result->queryPlanning->signalQueryExplorationV11");
    expect(admin).toContain("familyCoverageHistoryBySource");
  });
});
