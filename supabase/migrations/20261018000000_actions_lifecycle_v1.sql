-- Layer 10: safe concept Action lifecycle (actions_lifecycle_v1).
-- Additive only. Existing Action rows and legacy trigger types are preserved.
-- See docs/architecture.md Section 21.

-- 1. Lifecycle: `expired` Action status (system-only, sets stale_at).
alter table public.actions drop constraint if exists actions_status_check;
alter table public.actions add constraint actions_status_check check (status in (
  'proposed', 'approved', 'in_progress', 'completed', 'dismissed', 'superseded', 'expired'
));

-- 2. Events: `expired` transition and idempotent `revalidated` (continuity carry-forward).
alter table public.action_events drop constraint if exists action_events_event_type_check;
alter table public.action_events add constraint action_events_event_type_check check (event_type in (
  'approved', 'dismissed', 'started', 'completed', 'superseded', 'regenerated', 'expired', 'revalidated'
));

-- 3. Canonical concept identity (Layer 9 identity incl. clustering_version) and
--    the semantic proposal-continuity fingerprint. Nullable: legacy rows keep null.
alter table public.actions add column if not exists trigger_clustering_version text;
alter table public.actions add column if not exists proposal_fingerprint text;

-- 4. Concept Actions must carry the full identity; legacy Actions must not.
alter table public.actions drop constraint if exists actions_concept_identity_check;
alter table public.actions add constraint actions_concept_identity_check check (
  case
    when trigger_type in ('concept_gap', 'concept_drift') then
      trigger_clustering_version is not null
      and char_length(trim(trigger_clustering_version)) between 1 and 120
      and trigger_concept_key is not null
      and proposal_fingerprint is not null
      and proposal_fingerprint ~ '^[0-9a-f]{64}$'
    else
      trigger_clustering_version is null
      and proposal_fingerprint is null
  end
);

-- 5. Trigger validation: the evidence-node check is unchanged; concept Actions
--    additionally must match their persisted basis row's workspace, product,
--    clustering_version and anchor_concept_key.
create or replace function public.validate_action_trigger()
returns trigger language plpgsql set search_path = public as $$
declare
  v_entity_table text;
  v_node public.evidence_nodes;
  v_found boolean;
begin
  v_entity_table := case new.trigger_type
    when 'demand_gap' then 'demand_gaps'
    when 'demand_drift' then 'demand_drifts'
    when 'demand_snapshot' then 'demand_snapshots'
    when 'signal' then 'signals'
    when 'concept_gap' then 'concept_gap_states'
    when 'concept_drift' then 'concept_drift_states'
  end;
  select * into v_node from public.evidence_nodes where id = new.trigger_evidence_node_id;
  if v_node.id is null or v_node.entity_table <> v_entity_table or v_node.entity_id <> new.trigger_id
     or v_node.workspace_id is distinct from new.workspace_id then
    raise exception using errcode = '23514', message = 'action_trigger_evidence_mismatch';
  end if;
  if new.trigger_type = 'concept_gap' then
    select exists (
      select 1 from public.concept_gap_states s
       where s.workspace_id = new.workspace_id and s.product_id = new.product_id and s.id = new.trigger_id
         and s.clustering_version = new.trigger_clustering_version and s.anchor_concept_key = new.trigger_concept_key
    ) into v_found;
    if not v_found then
      raise exception using errcode = '23514', message = 'action_concept_identity_mismatch';
    end if;
  elsif new.trigger_type = 'concept_drift' then
    select exists (
      select 1 from public.concept_drift_states s
       where s.workspace_id = new.workspace_id and s.product_id = new.product_id and s.id = new.trigger_id
         and s.clustering_version = new.trigger_clustering_version and s.anchor_concept_key = new.trigger_concept_key
    ) into v_found;
    if not v_found then
      raise exception using errcode = '23514', message = 'action_concept_identity_mismatch';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists actions_validate_trigger on public.actions;
create trigger actions_validate_trigger
before insert or update of trigger_type, trigger_id, trigger_evidence_node_id, workspace_id, product_id, trigger_clustering_version, trigger_concept_key
on public.actions for each row execute function public.validate_action_trigger();

-- 6. Generated fields stay immutable, now including the two concept-only fields.
create or replace function public.prevent_action_generated_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.action_type is distinct from old.action_type
     or new.trigger_type is distinct from old.trigger_type
     or new.trigger_id is distinct from old.trigger_id
     or new.trigger_evidence_node_id is distinct from old.trigger_evidence_node_id
     or new.trigger_concept_key is distinct from old.trigger_concept_key
     or new.trigger_clustering_version is distinct from old.trigger_clustering_version
     or new.proposal_fingerprint is distinct from old.proposal_fingerprint
     or new.target_key is distinct from old.target_key
     or new.title is distinct from old.title
     or new.summary is distinct from old.summary
     or new.why is distinct from old.why
     or new.suggested_change is distinct from old.suggested_change
     or new.current_state is distinct from old.current_state
     or new.target_metric is distinct from old.target_metric
     or new.business_hypothesis is distinct from old.business_hypothesis
     or new.evidence_context is distinct from old.evidence_context
     or new.priority_score is distinct from old.priority_score
     or new.confidence is distinct from old.confidence
     or new.action_engine_version_id is distinct from old.action_engine_version_id
     or new.priority_formula_version is distinct from old.priority_formula_version
     or new.input_fingerprint is distinct from old.input_fingerprint
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception using errcode = '55000', message = 'phase5_action_generated_fields_are_immutable';
  end if;
  return new;
end;
$$;

-- 7. One open semantic Action per canonical concept. trigger_type is deliberately
--    NOT part of the slot: Gap and Drift compete for the same concept Action.
create unique index if not exists actions_one_open_concept_action
  on public.actions (workspace_id, product_id, trigger_clustering_version, trigger_concept_key)
  where trigger_type in ('concept_gap', 'concept_drift')
    and status in ('proposed', 'approved', 'in_progress');

create index if not exists actions_concept_history_idx
  on public.actions (workspace_id, product_id, trigger_clustering_version, trigger_concept_key, updated_at desc)
  where trigger_type in ('concept_gap', 'concept_drift');

-- 10. Bounded latest-state reads (one row per concept, <= 500 concepts), DB-side.
create or replace function public.concept_latest_market_states(
  p_workspace_id uuid, p_product_id uuid, p_clustering_version text, p_policy_version text, p_limit integer default 500
)
returns setof public.concept_market_states
language sql stable security invoker set search_path = public as $$
  select * from (
    select distinct on (s.anchor_concept_key) s.*
      from public.concept_market_states s
     where s.workspace_id = p_workspace_id and s.product_id = p_product_id
       and s.clustering_version = p_clustering_version and s.concept_market_state_policy_version = p_policy_version
     order by s.anchor_concept_key, s.sequence desc
  ) latest
  order by latest.anchor_concept_key
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

create or replace function public.concept_latest_gap_states(
  p_workspace_id uuid, p_product_id uuid, p_clustering_version text, p_policy_version text, p_limit integer default 500
)
returns setof public.concept_gap_states
language sql stable security invoker set search_path = public as $$
  select * from (
    select distinct on (s.anchor_concept_key) s.*
      from public.concept_gap_states s
     where s.workspace_id = p_workspace_id and s.product_id = p_product_id
       and s.clustering_version = p_clustering_version and s.gap_state_policy_version = p_policy_version
     order by s.anchor_concept_key, s.sequence desc
  ) latest
  order by latest.anchor_concept_key
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

create or replace function public.concept_latest_drift_states(
  p_workspace_id uuid, p_product_id uuid, p_clustering_version text, p_policy_version text, p_window text, p_limit integer default 500
)
returns setof public.concept_drift_states
language sql stable security invoker set search_path = public as $$
  select * from (
    select distinct on (s.anchor_concept_key) s.*
      from public.concept_drift_states s
     where s.workspace_id = p_workspace_id and s.product_id = p_product_id
       and s.clustering_version = p_clustering_version and s.drift_state_policy_version = p_policy_version
       and s.window_type = p_window
     order by s.anchor_concept_key, s.sequence desc
  ) latest
  order by latest.anchor_concept_key
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

-- Basis guard: the latest persisted market/gap/drift state ids the canonical
-- selector decided on must still be the latest, inside the writing transaction.
-- Guard shape: {"marketStatePolicyVersion","marketStateId","gapStatePolicyVersion",
-- "gapStateId"|null,"driftStatePolicyVersion","driftStateIds":{"7d":id|null,...}}
create or replace function public.assert_concept_action_basis_guard(
  p_workspace_id uuid, p_product_id uuid, p_clustering_version text, p_anchor_concept_key text, p_guard jsonb
)
returns void
language plpgsql stable security invoker set search_path = public as $$
declare
  v_latest uuid;
  v_window text;
begin
  if p_guard is null or jsonb_typeof(p_guard) <> 'object' or p_guard->>'marketStateId' is null then
    raise exception using errcode = '22023', message = 'action_basis_guard_required';
  end if;

  select s.id into v_latest from public.concept_market_states s
   where s.workspace_id = p_workspace_id and s.product_id = p_product_id and s.clustering_version = p_clustering_version
     and s.anchor_concept_key = p_anchor_concept_key and s.concept_market_state_policy_version = p_guard->>'marketStatePolicyVersion'
   order by s.sequence desc limit 1;
  if v_latest is distinct from (p_guard->>'marketStateId')::uuid then
    raise exception using errcode = '40001', message = 'action_basis_changed';
  end if;

  v_latest := null;
  select s.id into v_latest from public.concept_gap_states s
   where s.workspace_id = p_workspace_id and s.product_id = p_product_id and s.clustering_version = p_clustering_version
     and s.anchor_concept_key = p_anchor_concept_key and s.gap_state_policy_version = p_guard->>'gapStatePolicyVersion'
   order by s.sequence desc limit 1;
  if v_latest is distinct from nullif(p_guard->>'gapStateId', '')::uuid then
    raise exception using errcode = '40001', message = 'action_basis_changed';
  end if;

  for v_window in select jsonb_object_keys(coalesce(p_guard->'driftStateIds', '{}'::jsonb)) loop
    v_latest := null;
    select s.id into v_latest from public.concept_drift_states s
     where s.workspace_id = p_workspace_id and s.product_id = p_product_id and s.clustering_version = p_clustering_version
       and s.anchor_concept_key = p_anchor_concept_key and s.drift_state_policy_version = p_guard->>'driftStatePolicyVersion'
       and s.window_type = v_window
     order by s.sequence desc limit 1;
    if v_latest is distinct from nullif(p_guard->'driftStateIds'->>v_window, '')::uuid then
      raise exception using errcode = '40001', message = 'action_basis_changed';
    end if;
  end loop;
end;
$$;

-- 8. Atomic concept Action creation / supersession. Replay identity is
--    (workspace_id, idempotency_key), never the caller's UUID.
create or replace function public.create_concept_action(
  p_action jsonb,
  p_supersede_action_id uuid default null,
  p_expected_status text default null,
  p_basis_guard jsonb default null,
  p_provenance_weight numeric default 1,
  p_event_metadata jsonb default '{}'::jsonb,
  p_trace_id text default null
)
returns public.actions
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_input public.actions;
  v_old public.actions;
  v_existing public.actions;
  v_new public.actions;
begin
  v_input := jsonb_populate_record(null::public.actions, p_action);
  if v_input.workspace_id is null or v_input.product_id is null or v_input.id is null or v_input.evidence_node_id is null
     or v_input.idempotency_key is null or coalesce(v_input.trigger_type, '') not in ('concept_gap', 'concept_drift') then
    raise exception using errcode = '22023', message = 'invalid_concept_action_payload';
  end if;

  if p_supersede_action_id is not null then
    select * into v_old from public.actions
     where workspace_id = v_input.workspace_id and id = p_supersede_action_id
     for update;
    if v_old.id is null then
      raise exception using errcode = 'P0002', message = 'action_not_found';
    end if;
    if v_old.trigger_type not in ('concept_gap', 'concept_drift')
       or v_old.product_id <> v_input.product_id
       or v_old.trigger_clustering_version is distinct from v_input.trigger_clustering_version
       or v_old.trigger_concept_key <> v_input.trigger_concept_key then
      raise exception using errcode = '22023', message = 'action_supersession_identity_mismatch';
    end if;
  end if;

  -- Serialize every writer of this idempotency key, then resolve replays first.
  perform pg_advisory_xact_lock(hashtextextended(v_input.workspace_id::text || ':action:' || v_input.idempotency_key, 0));
  select * into v_existing from public.actions
   where workspace_id = v_input.workspace_id and idempotency_key = v_input.idempotency_key;

  if v_existing.id is not null then
    if v_old.id is null or v_old.id = v_existing.id then
      return v_existing;
    end if;
    if v_old.status = 'superseded' and v_old.superseded_by_action_id = v_existing.id then
      return v_existing;
    end if;
    if v_old.status = p_expected_status and v_old.status in ('proposed', 'approved') then
      update public.actions
         set status = 'superseded', stale_at = coalesce(stale_at, timezone('utc', now())), superseded_by_action_id = v_existing.id
       where workspace_id = v_old.workspace_id and id = v_old.id;
      insert into public.action_events (workspace_id, product_id, action_id, actor_user_id, actor_kind, event_type, from_status, to_status, metadata)
      values (v_old.workspace_id, v_old.product_id, v_old.id, null, 'system', 'superseded', v_old.status, 'superseded',
              coalesce(p_event_metadata, '{}'::jsonb) || jsonb_build_object('supersededByActionId', v_existing.id));
      return v_existing;
    end if;
    raise exception using errcode = '40001', message = 'action_replay_conflict';
  end if;

  if p_basis_guard is not null then
    perform public.assert_concept_action_basis_guard(v_input.workspace_id, v_input.product_id, v_input.trigger_clustering_version, v_input.trigger_concept_key, p_basis_guard);
  end if;

  if v_old.id is not null then
    if p_expected_status is null or v_old.status <> p_expected_status or v_old.status not in ('proposed', 'approved') then
      raise exception using errcode = '40001', message = 'action_status_conflict';
    end if;
    update public.actions
       set status = 'superseded', stale_at = coalesce(stale_at, timezone('utc', now()))
     where workspace_id = v_old.workspace_id and id = v_old.id;
  end if;

  insert into public.evidence_nodes (id, node_type, workspace_id, entity_table, entity_id)
  values (v_input.evidence_node_id, 'action', v_input.workspace_id, 'actions', v_input.id);

  insert into public.actions (
    id, workspace_id, product_id, evidence_node_id, action_type, trigger_type, trigger_id, trigger_evidence_node_id,
    trigger_concept_key, trigger_clustering_version, proposal_fingerprint, target_key, title, summary, why,
    suggested_change, current_state, target_metric, business_hypothesis, evidence_context, priority_score, confidence,
    status, action_engine_version_id, priority_formula_version, input_fingerprint, idempotency_key, valid_from
  ) values (
    v_input.id, v_input.workspace_id, v_input.product_id, v_input.evidence_node_id, v_input.action_type, v_input.trigger_type,
    v_input.trigger_id, v_input.trigger_evidence_node_id, v_input.trigger_concept_key, v_input.trigger_clustering_version,
    v_input.proposal_fingerprint, v_input.target_key, v_input.title, v_input.summary, v_input.why, v_input.suggested_change,
    v_input.current_state, v_input.target_metric, coalesce(v_input.business_hypothesis, '{}'::jsonb), coalesce(v_input.evidence_context, '{}'::jsonb),
    v_input.priority_score, v_input.confidence, 'proposed', v_input.action_engine_version_id, v_input.priority_formula_version,
    v_input.input_fingerprint, v_input.idempotency_key, timezone('utc', now())
  )
  returning * into v_new;

  insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal, engine_version_id)
  values (v_new.evidence_node_id, v_new.trigger_evidence_node_id, 'triggered_by', greatest(coalesce(p_provenance_weight, 1), 0), 0, v_new.action_engine_version_id)
  on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;

  if v_old.id is not null then
    update public.actions set superseded_by_action_id = v_new.id
     where workspace_id = v_old.workspace_id and id = v_old.id;
    insert into public.action_events (workspace_id, product_id, action_id, actor_user_id, actor_kind, event_type, from_status, to_status, metadata)
    values (v_old.workspace_id, v_old.product_id, v_old.id, null, 'system', 'superseded', v_old.status, 'superseded',
            coalesce(p_event_metadata, '{}'::jsonb) || jsonb_build_object('supersededByActionId', v_new.id));
    insert into public.action_events (workspace_id, product_id, action_id, actor_user_id, actor_kind, event_type, from_status, to_status, metadata)
    values (v_new.workspace_id, v_new.product_id, v_new.id, null, 'system', 'regenerated', null, 'proposed',
            coalesce(p_event_metadata, '{}'::jsonb) || jsonb_build_object('supersedesActionId', v_old.id));
    insert into public.evidence_provenance (derived_evidence_node_id, source_evidence_node_id, relation_type, weight, ordinal, engine_version_id)
    values (v_new.evidence_node_id, v_old.evidence_node_id, 'supersedes_action', 1, 0, v_new.action_engine_version_id)
    on conflict (derived_evidence_node_id, source_evidence_node_id, relation_type, ordinal) do nothing;
  end if;

  -- Exactly once per stored Action; a refusal rolls back the whole transaction.
  perform public.consume_usage(
    v_new.workspace_id, 'action_generated', 1, 'action_generated:' || v_new.id::text,
    jsonb_build_object('actionId', v_new.id, 'triggerType', v_new.trigger_type, 'triggerId', v_new.trigger_id),
    null, p_trace_id
  );

  return v_new;
end;
$$;

-- 9. Compare-and-set lifecycle transitions with the event (and, for users, the
--    audit row) written in the same transaction.
create or replace function public.transition_action(
  p_workspace_id uuid,
  p_action_id uuid,
  p_from text,
  p_to text,
  p_actor_kind text,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_basis_guard jsonb default null,
  p_trace_id text default null
)
returns public.actions
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_action public.actions;
  v_updated public.actions;
  v_concept boolean;
  v_now timestamptz := timezone('utc', now());
  v_event text;
begin
  if p_actor_kind not in ('user', 'system', 'service') then
    raise exception using errcode = '22023', message = 'invalid_actor_kind';
  end if;

  select * into v_action from public.actions where workspace_id = p_workspace_id and id = p_action_id for update;
  if v_action.id is null then
    raise exception using errcode = 'P0002', message = 'action_not_found';
  end if;
  if v_action.status <> p_from then
    raise exception using errcode = '40001', message = 'action_status_conflict';
  end if;
  v_concept := v_action.trigger_type in ('concept_gap', 'concept_drift');

  if not (
    (p_from = 'proposed' and (p_to in ('approved', 'dismissed', 'expired') or (p_to = 'superseded' and not v_concept)))
    or (p_from = 'approved' and (p_to in ('in_progress', 'dismissed', 'expired') or (p_to = 'superseded' and not v_concept)))
    or (p_from = 'in_progress' and p_to in ('completed', 'dismissed'))
  ) then
    raise exception using errcode = '22023', message = 'action_transition_invalid';
  end if;

  if p_to = 'expired' and p_actor_kind <> 'system' then
    raise exception using errcode = '42501', message = 'action_transition_system_only';
  end if;

  if p_actor_kind = 'user' then
    if p_actor_user_id is null or not exists (
      select 1 from public.workspace_members wm
       where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_user_id
         and wm.status = 'active' and wm.role in ('owner', 'admin', 'member')
    ) then
      raise exception using errcode = '42501', message = 'action_actor_forbidden';
    end if;
  end if;

  if v_concept and p_to in ('approved', 'in_progress') then
    perform public.assert_concept_action_basis_guard(v_action.workspace_id, v_action.product_id, v_action.trigger_clustering_version, v_action.trigger_concept_key, p_basis_guard);
  end if;

  update public.actions set
    status = p_to,
    approved_at = case when p_to = 'approved' then v_now else approved_at end,
    completed_at = case when p_to = 'completed' then v_now else completed_at end,
    dismissed_at = case when p_to = 'dismissed' then v_now else dismissed_at end,
    stale_at = case when p_to in ('expired', 'superseded') then coalesce(stale_at, v_now) else stale_at end
  where workspace_id = p_workspace_id and id = p_action_id and status = p_from
  returning * into v_updated;
  if v_updated.id is null then
    raise exception using errcode = '40001', message = 'action_status_conflict';
  end if;

  v_event := case p_to
    when 'approved' then 'approved' when 'in_progress' then 'started' when 'completed' then 'completed'
    when 'dismissed' then 'dismissed' when 'expired' then 'expired' when 'superseded' then 'superseded'
  end;
  insert into public.action_events (workspace_id, product_id, action_id, actor_user_id, actor_kind, event_type, from_status, to_status, metadata)
  values (v_updated.workspace_id, v_updated.product_id, v_updated.id, p_actor_user_id, p_actor_kind, v_event, p_from, p_to, coalesce(p_metadata, '{}'::jsonb));

  if p_actor_kind = 'user' then
    perform public.record_audit_event(p_workspace_id, p_actor_user_id, 'user', 'action.' || p_to, 'action', v_updated.id, p_trace_id, coalesce(p_metadata, '{}'::jsonb));
  end if;

  return v_updated;
end;
$$;

revoke all on function public.concept_latest_market_states(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.concept_latest_gap_states(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.concept_latest_drift_states(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.assert_concept_action_basis_guard(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text) from public, anon, authenticated;
revoke all on function public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.concept_latest_market_states(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.concept_latest_gap_states(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.concept_latest_drift_states(uuid, uuid, text, text, text, integer) to service_role;
grant execute on function public.assert_concept_action_basis_guard(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text) to service_role;
grant execute on function public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text) to service_role;

comment on column public.actions.trigger_clustering_version is 'Layer 10: clustering_version of the concept basis; part of canonical concept Action identity. Null for legacy trigger types.';
comment on column public.actions.proposal_fingerprint is 'Layer 10: action_proposal_continuity_v1 semantic proposal fingerprint. Null for legacy trigger types.';
comment on function public.create_concept_action(jsonb, uuid, text, jsonb, numeric, jsonb, text) is 'Layer 10: atomic concept Action creation/supersession; replay identity is (workspace_id, idempotency_key).';
comment on function public.transition_action(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text) is 'Layer 10: compare-and-set Action transition with event and audit in one transaction.';
