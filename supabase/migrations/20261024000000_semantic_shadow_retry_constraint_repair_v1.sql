-- Repair the legacy unconditional semantic-shadow identity constraint.
--
-- The original inline UNIQUE constraint received a PostgreSQL-truncated name,
-- so the retry migration's intended-name DROP did not remove it. Resolve the
-- actual constraint by its table, exact four-column key, and unconditional
-- index predicate instead of depending on an identifier spelling.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select c.conname
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      join pg_index i on i.indexrelid = c.conindid
     where n.nspname = 'public'
       and r.relname = 'semantic_shadow_reasoning'
       and c.contype = 'u'
       and i.indpred is null
       and c.conkey = array[
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'workspace_id'),
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'product_id'),
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'conversation_id'),
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'fingerprint')
       ]::smallint[]
  loop
    execute format('alter table public.semantic_shadow_reasoning drop constraint %I', legacy_constraint.conname);
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      join pg_index i on i.indexrelid = c.conindid
     where n.nspname = 'public'
       and r.relname = 'semantic_shadow_reasoning'
       and c.contype = 'u'
       and i.indpred is null
       and c.conkey = array[
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'workspace_id'),
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'product_id'),
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'conversation_id'),
         (select a.attnum from pg_attribute a where a.attrelid = r.oid and a.attname = 'fingerprint')
       ]::smallint[]
  ) then
    raise exception 'legacy semantic shadow unconditional uniqueness remains';
  end if;

  if not exists (
    select 1
      from pg_class i
      join pg_namespace n on n.oid = i.relnamespace
     where n.nspname = 'public'
       and i.relname = 'semantic_shadow_reasoning_reusable_fingerprint_key'
       and i.relkind = 'i'
  ) then
    raise exception 'semantic shadow reusable uniqueness index is missing';
  end if;
end;
$$;
