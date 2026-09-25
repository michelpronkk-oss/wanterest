-- Wanterest 1B Stage 2D: incremental product matching.
--
-- Additive/backwards-compatible; no backfill, no new tables.
--
-- 1. query_yield_artifacts.discovery_provenance (WORKSPACE/PRODUCT PRIVATE,
--    already RLS-protected by query_yield_artifacts_member_select): the exact
--    planner provenance template (query plan id, family, surface, concepts,
--    compiled retrieval anchors) a product scan attached to one executed
--    query. It lets incremental matching hand new public evidence from a
--    refreshed global partition to the frozen candidate-selection / retrieval
--    precision filters with the same product-relative context the product's
--    own scan used. It never enters global partition identity or state.
--
-- 2. Two job types, both recorded in job_runs with DB-enforced
--    unique (job_type, idempotency_key):
--    - match-partition-incremental: GLOBAL fanout decision for one successful
--      refresh job (workspace_id/product_id null) - which interested products
--      were considered, dispatched, capped, or skipped and why.
--    - match-product-incremental: PRODUCT PRIVATE run for one
--      (refresh job, product) pair (workspace_id/product_id set).

alter table public.query_yield_artifacts
  add column if not exists discovery_provenance jsonb;

alter table public.query_yield_artifacts
  drop constraint if exists query_yield_artifacts_discovery_provenance_check;
alter table public.query_yield_artifacts
  add constraint query_yield_artifacts_discovery_provenance_check
  check (discovery_provenance is null or jsonb_typeof(discovery_provenance) = 'object');

alter table public.job_runs drop constraint if exists job_runs_job_type_check;
alter table public.job_runs add constraint job_runs_job_type_check check (job_type in (
  'discover-source', 'normalize-source-items', 'dedupe-conversations',
  'analyze-conversations', 'match-product', 'rank-matches',
  'aggregate-demand', 'calculate-demand-gap', 'calculate-demand-drift',
  'backfill-demand-snapshots', 'generate-actions', 'build-digest',
  'process-billing-webhook', 'reconcile-billing-subscription',
  'aggregate-experiment-results', 'finalize-experiment', 'backfill-experiment-results',
  'refresh-market-partition',
  'match-partition-incremental', 'match-product-incremental'
));

-- Interest lookup reuses query_yield_artifacts_market_partition_idx
-- (market_partition_key, created_at desc) from Stage 2B; no new index.
