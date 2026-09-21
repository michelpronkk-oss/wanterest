-- Correct the Phase 3 grants omitted from the deployed intelligence migration.
-- These tables remain inaccessible to anon/authenticated clients; service_role is
-- server-only and is used by the intelligence repositories and replayable jobs.

grant usage on schema public to service_role;

grant all on public.products,
  public.product_snapshots,
  public.demand_profiles,
  public.demand_profile_snapshot_inputs,
  public.discovery_strategies,
  public.product_matches,
  public.product_match_evaluations,
  public.match_rankings,
  public.signals,
  public.match_feedback
to service_role;
