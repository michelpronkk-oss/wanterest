-- Signal Throughput V1: profile-grounded query taxonomy and bounded novelty telemetry.
-- This extends existing private execution/outcome telemetry; it does not change acquisition
-- budgets, provider syntax, evaluation, qualification, provenance, or signal lifecycle.

alter table public.source_query_executions
  add column intent_family text not null default 'unclassified'
    check (intent_family in (
      'pain_frustration', 'unmet_need', 'feature_request', 'workaround_manual_workflow',
      'switching_intent', 'replacement_substitute', 'alternative_search',
      'comparison_versus', 'purchase_adoption', 'cancellation_abandonment',
      'missing_integration', 'pricing_wtp_friction', 'workflow_inefficiency',
      'competitor_complaint', 'category_dissatisfaction', 'job_to_be_done',
      'unclassified'
    )),
  add column query_variant_version text not null default 'legacy'
    check (query_variant_version in ('legacy', 'signal_query_diversification_v1'));

alter table public.product_query_result_outcomes
  add column evidence_eligible boolean;

comment on column public.source_query_executions.intent_family is
  'Closed, profile-grounded discovery intent label; unclassified denotes historical or unsupported evidence.';
comment on column public.source_query_executions.query_variant_version is
  'Planner treatment identifier; legacy denotes executions before Signal Throughput V1.';
comment on column public.product_query_result_outcomes.evidence_eligible is
  'Nullable marker for surviving unchanged evidence and dedupe filters before the synchronous evaluation cap; null means that eligibility could not be fully observed.';

create index source_query_executions_query_history_idx
  on public.source_query_executions (parent_job_run_id, source_key, query_plan_fingerprint, completed_at desc);
create index query_yield_artifacts_product_history_idx
  on public.query_yield_artifacts (workspace_id, product_id, created_at desc);
create or replace function public.signal_query_novelty_history(
  p_workspace_id uuid default null,
  p_product_id uuid default null,
  p_since timestamptz default now() - interval '90 days',
  p_max_scans integer default 12
)
returns table (
  execution_id uuid,
  scan_job_run_id uuid,
  source_key text,
  query_family text,
  intent_family text,
  query_variant_version text,
  query_plan_fingerprint text,
  execution_status text,
  provider_results integer,
  raw_snapshots_inserted integer,
  raw_snapshots_duplicate integer,
  unique_provider_items integer,
  normalized_items integer,
  attributable_results integer,
  unique_roots integer,
  independent_roots integer,
  new_root_attributions integer,
  new_independent_roots integer,
  known_root_attributions integer,
  duplicate_root_attributions integer,
  evidence_eligible_roots integer,
  evidence_eligibility_known_roots integer,
  evaluated_roots integer,
  qualified_roots integer,
  new_independent_qualified_roots integer,
  signal_roots integer,
  history_truncated boolean,
  completed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with scan_groups as (
    select qya.workspace_id, qya.product_id, qya.job_run_id,
      max(qya.created_at) as scan_artifact_at
    from public.query_yield_artifacts as qya
    where qya.created_at >= greatest(coalesce(p_since, now() - interval '90 days'), now() - interval '90 days')
      and (p_workspace_id is null or qya.workspace_id = p_workspace_id)
      and (p_product_id is null or qya.product_id = p_product_id)
    group by qya.workspace_id, qya.product_id, qya.job_run_id
  ),
  ranked_scans as (
    select sg.*,
      row_number() over (
        partition by sg.workspace_id, sg.product_id
        order by sg.scan_artifact_at desc, sg.job_run_id desc
      ) as scan_rank
    from scan_groups as sg
  ),
  eligible_scans as (
    select rs.workspace_id, rs.product_id, rs.job_run_id, rs.scan_artifact_at
    from ranked_scans as rs
    where rs.scan_rank <= least(greatest(coalesce(p_max_scans, 12), 1), 30)
  ),
  recent_scans as (
    select es.*, count(*) over () > 1000 as history_truncated
    from eligible_scans as es
    order by es.scan_artifact_at desc, es.workspace_id, es.product_id, es.job_run_id desc
    limit 1000
  ),
  planned_executions as (
    select distinct on (qya.workspace_id, qya.product_id, qya.job_run_id, e.query_plan_fingerprint)
      e.id as execution_id,
      qya.job_run_id as scan_job_run_id,
      qya.workspace_id,
      qya.product_id,
      e.source_key,
      e.query_family,
      e.intent_family,
      e.query_variant_version,
      e.query_plan_fingerprint,
      e.execution_status,
      e.provider_results_returned as provider_results,
      e.raw_snapshots_inserted,
      e.raw_snapshots_duplicate,
      e.unique_provider_items,
      e.normalized_items,
      e.completed_at,
      rs.history_truncated,
      j.created_at as scan_created_at
    from recent_scans as rs
    join public.query_yield_artifacts as qya
      on qya.workspace_id = rs.workspace_id
      and qya.product_id = rs.product_id
      and qya.job_run_id = rs.job_run_id
    join public.source_query_executions as e
      on e.parent_job_run_id = qya.job_run_id
      and e.source_key = qya.source_key
      and e.query_plan_fingerprint = encode(
        extensions.digest(to_jsonb(qya.query_plan_id)::text, 'sha256'), 'hex'
      )
    join public.job_runs as j on j.id = qya.job_run_id
    order by qya.workspace_id, qya.product_id, qya.job_run_id,
      e.query_plan_fingerprint, e.completed_at desc, e.id desc
  ),
  query_roots as (
    select pe.execution_id, pe.scan_job_run_id, pe.workspace_id, pe.product_id,
      pe.source_key, pe.query_family, pe.intent_family, pe.query_variant_version,
      pe.query_plan_fingerprint, pe.execution_status, pe.provider_results,
      pe.completed_at, pe.scan_created_at, a.conversation_id,
      bool_or(o.evidence_eligible) as evidence_eligible,
      bool_or(o.evidence_eligible is not null) as evidence_eligibility_known,
      bool_or(o.evaluated) as evaluated,
      bool_or(o.qualification_status = 'qualified') as qualified,
      bool_or(o.signal_id is not null) as has_signal
    from planned_executions as pe
    join public.source_query_execution_pages as page on page.execution_id = pe.execution_id
    join public.source_query_result_attributions as a on a.page_id = page.id
    left join public.product_query_result_outcomes as o
      on o.source_query_result_attribution_id = a.id
      and o.conversation_id = a.conversation_id
      and o.workspace_id = pe.workspace_id
      and o.product_id = pe.product_id
      and o.match_job_run_id = pe.scan_job_run_id
    where a.conversation_id is not null
    group by pe.execution_id, pe.scan_job_run_id, pe.workspace_id, pe.product_id,
      pe.source_key, pe.query_family, pe.intent_family, pe.query_variant_version,
      pe.query_plan_fingerprint, pe.execution_status, pe.provider_results,
      pe.completed_at, pe.scan_created_at, a.conversation_id
  ),
  result_attribution_counts as (
    select pe.execution_id, count(a.id)::integer as attributable_results
    from planned_executions as pe
    left join public.source_query_execution_pages as page on page.execution_id = pe.execution_id
    left join public.source_query_result_attributions as a on a.page_id = page.id
    group by pe.execution_id
  ),
  attributed_roots as (
    select qr.*,
      exists (
        select 1
        from public.query_yield_artifacts as previous_artifact
        join public.source_query_executions as previous_execution
          on previous_execution.parent_job_run_id = previous_artifact.job_run_id
        join public.source_query_execution_pages as previous_page
          on previous_page.execution_id = previous_execution.id
        join public.source_query_result_attributions as previous_attribution
          on previous_attribution.page_id = previous_page.id
          and previous_attribution.conversation_id = qr.conversation_id
        join public.job_runs as previous_job on previous_job.id = previous_artifact.job_run_id
        where previous_artifact.workspace_id = qr.workspace_id
          and previous_artifact.product_id = qr.product_id
          and previous_artifact.created_at >= now() - interval '90 days'
          and (previous_job.created_at, previous_job.id) < (qr.scan_created_at, qr.scan_job_run_id)
          and previous_job.created_at >= now() - interval '90 days'
      ) as was_known_before_scan,
      row_number() over (
        partition by qr.workspace_id, qr.product_id, qr.scan_job_run_id, qr.conversation_id
        order by qr.completed_at, qr.source_key, qr.intent_family,
          qr.query_plan_fingerprint, qr.execution_id
      ) as scan_root_owner_rank
    from query_roots as qr
  )
  select pe.execution_id,
    pe.scan_job_run_id,
    pe.source_key,
    pe.query_family,
    pe.intent_family,
    pe.query_variant_version,
    pe.query_plan_fingerprint,
    pe.execution_status,
    pe.provider_results,
    pe.raw_snapshots_inserted,
    pe.raw_snapshots_duplicate,
    pe.unique_provider_items,
    pe.normalized_items,
    result_counts.attributable_results,
    count(ar.conversation_id)::integer as unique_roots,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank = 1)::integer as independent_roots,
    count(ar.conversation_id) filter (where not ar.was_known_before_scan)::integer as new_root_attributions,
    count(ar.conversation_id) filter (
      where ar.scan_root_owner_rank = 1 and not ar.was_known_before_scan
    )::integer as new_independent_roots,
    count(ar.conversation_id) filter (where ar.was_known_before_scan)::integer as known_root_attributions,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank > 1)::integer as duplicate_root_attributions,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank = 1 and ar.evidence_eligible is true)::integer as evidence_eligible_roots,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank = 1 and ar.evidence_eligibility_known is true)::integer as evidence_eligibility_known_roots,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank = 1 and ar.evaluated is true)::integer as evaluated_roots,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank = 1 and ar.qualified is true)::integer as qualified_roots,
    count(ar.conversation_id) filter (
      where ar.scan_root_owner_rank = 1 and not ar.was_known_before_scan and ar.qualified is true
    )::integer as new_independent_qualified_roots,
    count(ar.conversation_id) filter (where ar.scan_root_owner_rank = 1 and ar.has_signal is true)::integer as signal_roots,
    pe.history_truncated,
    pe.completed_at
  from planned_executions as pe
  left join result_attribution_counts as result_counts on result_counts.execution_id = pe.execution_id
  left join attributed_roots as ar on ar.execution_id = pe.execution_id
  group by pe.execution_id, pe.scan_job_run_id, pe.source_key, pe.query_family,
    pe.intent_family, pe.query_variant_version, pe.query_plan_fingerprint,
    pe.execution_status, pe.provider_results, pe.raw_snapshots_inserted, pe.raw_snapshots_duplicate, pe.unique_provider_items, pe.normalized_items, result_counts.attributable_results, pe.history_truncated, pe.completed_at
  order by pe.completed_at desc, pe.source_key, pe.intent_family, pe.query_plan_fingerprint;
$function$;

revoke all on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer)
  to service_role;

comment on function public.signal_query_novelty_history(uuid, uuid, timestamptz, integer) is
  'Bounded, read-only private query novelty and funnel aggregates. Returns hashes/counts only; service_role-only. Null product filters are reserved for the private Admin aggregate reader.';
