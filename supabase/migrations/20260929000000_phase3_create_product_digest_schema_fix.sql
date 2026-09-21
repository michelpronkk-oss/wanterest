-- Phase 3 corrective migration: pgcrypto is installed in the Supabase
-- extensions schema, while create_product intentionally keeps a narrow
-- SECURITY DEFINER search_path.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.create_product(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_website_url text default null
)
returns public.products
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_product public.products;
  v_limit bigint;
begin
  if not public.is_service_role() and not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':products', 0));
  select (value_json #>> '{}')::bigint into v_limit
    from public.workspace_entitlements
   where workspace_id = p_workspace_id and capability_key = 'products_max' and effective_to is null;
  if v_limit is null then raise exception using errcode = 'P0001', message = 'products_capability_missing'; end if;
  if (select count(*) from public.products where workspace_id = p_workspace_id and status = 'active') >= v_limit then
    raise exception using errcode = '22003', message = 'products_limit_exceeded';
  end if;
  insert into public.products (workspace_id, name, slug, website_url) values (p_workspace_id, trim(p_name), lower(trim(p_slug)), nullif(trim(p_website_url), '')) returning * into v_product;
  insert into public.evidence_nodes (node_type, workspace_id, entity_table, entity_id, content_hash)
  values ('product', p_workspace_id, 'products', v_product.id, encode(extensions.digest(v_product.id::text, 'sha256'::text), 'hex'));
  return v_product;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'product_slug_already_exists';
end;
$$;

grant execute on function public.create_product(uuid, text, text, text) to authenticated, service_role;
