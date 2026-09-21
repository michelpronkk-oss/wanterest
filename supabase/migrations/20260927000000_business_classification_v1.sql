-- Business Classification v1: register the existing immutable engine-version
-- convention for product classification. No new table or column is required;
-- the normalized classification is stored in product_snapshots.metadata.
-- Forward-only: preserve all Phase 1-7 engine types.

alter table public.engine_versions drop constraint if exists engine_versions_engine_type_check;
alter table public.engine_versions add constraint engine_versions_engine_type_check check (engine_type in (
  'profile', 'classifier', 'matcher', 'ranker', 'map', 'gap', 'drift',
  'action', 'action_variant', 'digest_composer', 'classification'
));

