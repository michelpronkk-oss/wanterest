-- Narrow the private query-yield artifact ACL to the server-side readers/writer.
-- All production callers use server-only service clients; authenticated SELECT has no live use.
-- Existing schema-wide default privileges are intentionally unchanged.
revoke all privileges on table public.query_yield_artifacts from public;
revoke all privileges on table public.query_yield_artifacts from anon;
revoke all privileges on table public.query_yield_artifacts from authenticated;
revoke all privileges on table public.query_yield_artifacts from service_role;

drop policy if exists query_yield_artifacts_member_select on public.query_yield_artifacts;

grant select, insert on table public.query_yield_artifacts to service_role;
