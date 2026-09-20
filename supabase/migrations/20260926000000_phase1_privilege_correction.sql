-- Correct the Phase 1 table privileges that were omitted from the deployed
-- foundation migration. RLS remains the tenant boundary; these grants only
-- make the intended policies reachable by PostgREST and server-side jobs.

grant usage on schema public to authenticated, service_role;

grant select on public.workspaces,
  public.workspace_members,
  public.plan_catalog,
  public.plan_entitlements,
  public.workspace_entitlements,
  public.usage_ledger,
  public.audit_log
to authenticated;

grant all on public.workspaces,
  public.workspace_members,
  public.plan_catalog,
  public.plan_entitlements,
  public.workspace_entitlements,
  public.usage_ledger,
  public.audit_log,
  public.engine_versions
to service_role;
