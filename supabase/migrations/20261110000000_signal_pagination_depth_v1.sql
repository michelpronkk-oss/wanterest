-- Signal Pagination / Depth V1: closed, count-free decision metadata on the
-- existing private per-page execution rows. Result/insert/root counts continue
-- to use the existing page and result-attribution columns.
begin;

alter table public.source_query_execution_pages
  add column pagination_policy_version text,
  add column continuation_eligible boolean,
  add column continuation_reason text,
  add column continuation_attempted boolean not null default false,
  add column continuation_status text,
  add constraint source_query_execution_pages_pagination_policy_version_check
    check (pagination_policy_version is null or pagination_policy_version = 'signal_pagination_depth_v1'),
  add constraint source_query_execution_pages_continuation_reason_check
    check (continuation_reason is null or continuation_reason in (
      'eligible_high_novelty',
      'first_page_failed',
      'empty_first_page',
      'no_cursor',
      'page_budget_exhausted',
      'no_new_raw_evidence',
      'no_unique_provider_items',
      'no_independent_roots',
      'insufficient_root_attribution',
      'repetitive_provider_items',
      'repetitive_roots',
      'provider_rate_limit_exhausted',
      'scan_continuation_budget_exhausted'
    )),
  add constraint source_query_execution_pages_continuation_status_check
    check (continuation_status is null or continuation_status in (
      'not_attempted', 'received', 'empty', 'repetitive', 'failed'
    )),
  add constraint source_query_execution_pages_continuation_attempt_check
    check (
      (continuation_status in ('received', 'empty', 'repetitive', 'failed')) = continuation_attempted
      or (continuation_status is null and not continuation_attempted)
    ),
  add constraint source_query_execution_pages_continuation_eligibility_check
    check (
      (continuation_eligible is true and continuation_reason = 'eligible_high_novelty')
      or (continuation_eligible is false and continuation_reason is not null and continuation_reason <> 'eligible_high_novelty')
      or (continuation_eligible is null and continuation_reason is null)
    ),
  add constraint source_query_execution_pages_pagination_scope_check
    check (
      pagination_policy_version is distinct from 'signal_pagination_depth_v1'
      or (page_number = 1 and continuation_eligible is not null and continuation_reason is not null and continuation_status is not null and continuation_attempted = continuation_eligible)
      or (page_number = 2 and continuation_eligible is null and continuation_reason is null and continuation_status is null and not continuation_attempted)
    );

comment on column public.source_query_execution_pages.pagination_policy_version is
  'Count-free policy tag; signal_pagination_depth_v1 identifies pages executed under the adaptive one-continuation policy. NULL means legacy or historical behavior.';
comment on column public.source_query_execution_pages.continuation_eligible is
  'First-page decision only. NULL means no Pagination V1 decision was recorded; eligibility never depends on qualification.';
comment on column public.source_query_execution_pages.continuation_reason is
  'Closed reason code for the first-page depth decision; contains no query, cursor, content, or product context.';
comment on column public.source_query_execution_pages.continuation_attempted is
  'True only when the single opt-in continuation request was actually attempted; page-level result counts stay on the continuation page row.';
comment on column public.source_query_execution_pages.continuation_status is
  'First-page summary of the one bounded continuation: not_attempted, received, empty, repetitive, or failed.';

commit;
