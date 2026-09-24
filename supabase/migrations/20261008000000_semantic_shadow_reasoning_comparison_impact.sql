alter table public.semantic_shadow_reasoning
  alter column shadow_impact drop default;

alter table public.semantic_shadow_reasoning
  alter column shadow_impact type jsonb using jsonb_build_array(shadow_impact);

alter table public.semantic_shadow_reasoning
  alter column shadow_impact set default '[]'::jsonb;
