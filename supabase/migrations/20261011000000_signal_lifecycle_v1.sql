-- Signal Lifecycle V1: preserve materialized signal history while allowing
-- explicitly invalidated or retracted rows to leave the current read model.

alter table public.signals
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_reason text,
  add column if not exists invalidated_by text,
  add column if not exists retracted_at timestamptz,
  add column if not exists retracted_reason text,
  add column if not exists retracted_by text,
  add column if not exists lifecycle_version text not null default 'signal_lifecycle_v1';

alter table public.signals
  drop constraint if exists signals_lifecycle_status_check;

alter table public.signals
  add constraint signals_lifecycle_status_check
  check (lifecycle_status in ('active', 'saved', 'dismissed', 'archived', 'invalidated', 'retracted'));

alter table public.signals
  add constraint signals_lifecycle_version_length_check
  check (char_length(lifecycle_version) between 1 and 120),
  add constraint signals_lifecycle_reason_length_check
  check (
    (invalidated_reason is null or char_length(invalidated_reason) between 1 and 160)
    and (retracted_reason is null or char_length(retracted_reason) between 1 and 160)
  );

create index if not exists signals_product_current_lifecycle_idx
  on public.signals (workspace_id, product_id, lifecycle_status, created_at desc);

-- Keep the existing user lifecycle RPC from reactivating terminal lifecycle
-- states. Internal lifecycle transitions use the provider-neutral helper in
-- the application service below and retain the audit columns on the row.
create or replace function public.set_signal_lifecycle(
  p_workspace_id uuid,
  p_signal_id uuid,
  p_lifecycle_status text
)
returns public.signals
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_signal public.signals;
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if p_lifecycle_status not in ('active', 'saved', 'dismissed', 'archived') then
    raise exception using errcode = '22023', message = 'invalid_signal_lifecycle';
  end if;

  select * into v_signal
    from public.signals
   where workspace_id = p_workspace_id and id = p_signal_id
   for update;
  if v_signal.id is null then
    raise exception using errcode = 'P0002', message = 'signal_not_found';
  end if;
  if v_signal.lifecycle_status in ('invalidated', 'retracted') then
    raise exception using errcode = '55000', message = 'terminal_signal_lifecycle';
  end if;

  update public.signals
     set lifecycle_status = p_lifecycle_status
   where workspace_id = p_workspace_id and id = p_signal_id
   returning * into v_signal;
  return v_signal;
end;
$$;

-- One-time, exact-ID correction for the confirmed historical X/Jira false
-- positive. The conversation predicate is an additional safety guard; no
-- broad pattern matching or other signal mutation is performed.
update public.signals
   set lifecycle_status = 'invalidated',
       invalidated_at = coalesce(invalidated_at, timezone('utc', now())),
       invalidated_reason = coalesce(invalidated_reason, 'historical_clause_binding_false_positive'),
       invalidated_by = coalesce(invalidated_by, 'signal_lifecycle_v1_migration'),
       lifecycle_version = 'signal_lifecycle_v1'
 where id = '0774492f-fee2-450f-9ffe-98956b9bb1c6'::uuid
   and conversation_id = '64ecae9e-4ec9-53d7-aaa5-0bbc459cbf2f'::uuid
   and lifecycle_status not in ('invalidated', 'retracted');
