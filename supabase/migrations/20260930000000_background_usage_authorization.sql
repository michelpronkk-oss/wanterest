-- Forward-only correction for trusted background usage consumption.
-- Supabase/PostgREST deployments may expose the JWT role in either the
-- legacy request.jwt.claim.role setting or the consolidated request.jwt.claims
-- JSON setting. Both must identify the service_role without widening browser
-- table access or changing the consume_usage grant boundary.

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true) = 'service_role'
    or (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role',
    false
  );
$$;

