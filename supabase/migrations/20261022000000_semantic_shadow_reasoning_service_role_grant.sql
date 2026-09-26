-- Restore the server-only privileges omitted when semantic_shadow_reasoning was created.
-- The preview and semantic-shadow persistence paths use the service-role client;
-- anon/authenticated access and the existing RLS policy remain unchanged.
grant select, insert, update on public.semantic_shadow_reasoning to service_role;
