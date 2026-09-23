-- Dodo Billing v1 hardening: durable webhook attempts and an atomic claim.
-- Forward-only and additive; the Phase 6 billing tables remain the system of record.

alter table public.billing_webhook_events
  add column if not exists attempts integer not null default 0;

alter table public.billing_webhook_events
  drop constraint if exists billing_webhook_events_attempts_check;
alter table public.billing_webhook_events
  add constraint billing_webhook_events_attempts_check check (attempts >= 0);

create or replace function public.claim_billing_webhook(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  update public.billing_webhook_events
     set processing_status = 'processing',
         attempts = attempts + 1
   where id = p_event_id
     and processing_status in ('received', 'failed');

  return found;
end;
$$;

grant execute on function public.claim_billing_webhook(uuid) to service_role;

comment on column public.billing_webhook_events.attempts is 'Number of durable processing claims, including retries.';
