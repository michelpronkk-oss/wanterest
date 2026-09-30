-- SEO-2.6 forward-only private public-intelligence foundation.
-- Requires production head 20261102000000. No 13B migration is replayed.
-- Empty schema only: no source/customer data copied; no public route or publication is added.
do $check$
begin
  if to_regclass('public.admin_memberships') is null or to_regclass('public.admin_audit_events') is null
    or to_regclass('public.conversations') is null or to_regclass('public.source_items') is null then
    raise exception 'seo26_required_schema_missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.admin_memberships'::regclass and conname='admin_memberships_role_check' and pg_get_constraintdef(oid) like '%read_only_analyst%' and pg_get_constraintdef(oid) like '%operations_admin%' and pg_get_constraintdef(oid) like '%founder%') then raise exception 'seo26_admin_role_constraint_mismatch'; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.admin_audit_events'::regclass and conname='admin_audit_events_actor_role_check' and pg_get_constraintdef(oid) like '%read_only_analyst%' and pg_get_constraintdef(oid) like '%system%') then raise exception 'seo26_admin_audit_role_constraint_mismatch'; end if;
  if to_regclass('public.organic_public_source_families') is not null
    or to_regclass('public.organic_public_source_policies') is not null
    or to_regclass('public.organic_public_entities') is not null
    or to_regclass('public.organic_public_topics') is not null
    or to_regclass('public.organic_public_viral_events') is not null
    or to_regclass('public.organic_public_episodes') is not null
    or to_regclass('public.organic_public_episode_links') is not null
    or to_regclass('public.organic_readiness_candidates') is not null
    or to_regclass('public.organic_readiness_evaluations') is not null
    or to_regclass('public.organic_candidate_evidence') is not null
    or to_regclass('public.organic_candidate_review_events') is not null then
    raise exception 'seo26_objects_already_exist';
  end if;
end;
$check$;

create table public.organic_public_source_families (
  family_key text primary key check (family_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  label text not null check (char_length(trim(label)) between 1 and 120),
  source_kind text not null check (source_kind in ('third_party','first_party','uncertain')),
  independence_notes text not null check (char_length(trim(independence_notes)) between 20 and 500)
);
insert into public.organic_public_source_families values
 ('community_discussion','Community discussion','third_party','Discussion providers within this family do not establish independent source-family diversity.'),
 ('developer_community','Developer community','third_party','Code hosting and collaboration providers within this family do not establish independent source-family diversity.'),
 ('social_platform','Social platform','third_party','Replies and reposts inside one event do not count as independent episodes.'),
 ('video_comments','Video comments','third_party','Comments on one video or event count as one concentrated event, not independent demand.'),
 ('review_platform','Review platform','third_party','A review provider is a source family only after rights and independence are reviewed.'),
 ('editorial_reporting','Editorial and reporting','third_party','Independent publications require rights, source quality, and syndication review.'),
 ('first_party_company','First-party company source','first_party','May confirm supply claims but never counts as independent third-party demand evidence.');

create table public.organic_public_source_policies (
  provider_key text primary key check (provider_key ~ '^[a-z][a-z0-9_-]{0,79}$'),
  family_key text not null references public.organic_public_source_families(family_key) on delete restrict,
  policy_state text not null default 'unknown' check (policy_state in ('unknown','restricted','approved','blocked')),
  context_scope text not null default 'unknown' check (context_scope in ('unknown','context_independent_public','workspace_selected_public','tenant_private','first_party')),
  reuse_state text not null default 'unknown' check (reuse_state in ('unknown','aggregate_only','paraphrase_allowed','excerpt_allowed','blocked')),
  allowed_projection_fields text[] not null default '{}' check (allowed_projection_fields <@ array[
    'aggregate_counts','paraphrase','approved_excerpt','source_attribution','author_display_name',
    'author_profile_url','provider_identity','provider_id','timestamp','geography','topic_identity','entity_name']::text[]),
  raw_conversation_content_use text not null default 'unknown' check (raw_conversation_content_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  author_identity_use text not null default 'unknown' check (author_identity_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  canonical_url_use text not null default 'unknown' check (canonical_url_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  provider_ids_use text not null default 'unknown' check (provider_ids_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  timestamps_use text not null default 'unknown' check (timestamps_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  evidence_excerpts_use text not null default 'unknown' check (evidence_excerpts_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  derived_topics_use text not null default 'unknown' check (derived_topics_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  geography_use text not null default 'unknown' check (geography_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  company_entity_references_use text not null default 'unknown' check (company_entity_references_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  private_connectors_use text not null default 'blocked' check (private_connectors_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  workspace_interpretation_use text not null default 'blocked' check (workspace_interpretation_use in ('unknown','internal_aggregate','public_paraphrase','public_attribution','public_excerpt','blocked')),
  approved_hostnames text[] not null default '{}',
  policy_version integer not null default 1 check (policy_version>0),
  policy_basis_url text,
  review_reference text,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key,family_key),
  check (policy_state<>'approved' or (
    context_scope='context_independent_public'
    and reuse_state in ('aggregate_only','paraphrase_allowed','excerpt_allowed')
    and 'aggregate_counts'=any(allowed_projection_fields)
    and cardinality(allowed_projection_fields)>0 and policy_basis_url is not null and policy_basis_url like 'https://%'
    and nullif(trim(review_reference),'') is not null and reviewed_by_user_id is not null and reviewed_at is not null
    and raw_conversation_content_use='internal_aggregate'
    and author_identity_use in ('internal_aggregate','blocked')
    and canonical_url_use in ('internal_aggregate','public_attribution','blocked')
    and provider_ids_use='blocked'
    and timestamps_use='internal_aggregate'
    and evidence_excerpts_use in ('internal_aggregate','public_excerpt','blocked')
    and derived_topics_use in ('internal_aggregate','public_paraphrase')
    and geography_use in ('internal_aggregate','public_paraphrase','blocked')
    and company_entity_references_use in ('internal_aggregate','public_paraphrase','blocked')
    and private_connectors_use='blocked' and workspace_interpretation_use='blocked')),
  check (not (allowed_projection_fields && array['author_display_name','author_profile_url','provider_identity','provider_id']::text[])),
  check (canonical_url_use<>'public_attribution' or (cardinality(approved_hostnames)>0 and 'source_attribution'=any(allowed_projection_fields))),
  check (evidence_excerpts_use<>'public_excerpt' or 'approved_excerpt'=any(allowed_projection_fields)),
  check (policy_state<>'restricted' or (
    context_scope='context_independent_public' and reuse_state='aggregate_only'
    and raw_conversation_content_use='internal_aggregate'
    and author_identity_use in ('internal_aggregate','blocked')
    and canonical_url_use in ('internal_aggregate','blocked')
    and provider_ids_use='blocked' and timestamps_use='internal_aggregate'
    and evidence_excerpts_use in ('internal_aggregate','blocked')
    and derived_topics_use in ('internal_aggregate','blocked')
    and geography_use in ('internal_aggregate','blocked')
    and company_entity_references_use in ('internal_aggregate','blocked')
    and private_connectors_use='blocked' and workspace_interpretation_use='blocked'
    and approved_hostnames='{}'::text[]
    and allowed_projection_fields <@ array['aggregate_counts','topic_identity']::text[])),
  check (policy_state not in ('approved','restricted') or (
    policy_basis_url is not null and policy_basis_url like 'https://%' and nullif(trim(review_reference),'') is not null
    and reviewed_by_user_id is not null and reviewed_at is not null))
);
comment on column public.organic_public_source_policies.policy_state is
  'unknown fails closed; restricted permits context-independent internal aggregates only; approved permits only explicitly reviewed public-safe projection fields; blocked is never admitted.';
-- Current production provider/family mappings intentionally start unknown.
insert into public.organic_public_source_policies(provider_key,family_key) values
 ('bluesky','social_platform'),('github','developer_community'),
 ('hacker-news','community_discussion'),('stack-exchange','community_discussion'),
 ('x','social_platform'),('youtube','video_comments');

create table public.organic_public_entities (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null unique check (entity_key ~ '^[a-z0-9][a-z0-9._:-]{1,199}$'),
  entity_type text not null check (entity_type in ('organization','product','technology','geography','other')),
  public_label text not null check (char_length(trim(public_label)) between 2 and 160),
  identity_state text not null default 'proposed' check (identity_state in ('proposed','approved','rejected','merged')),
  merged_into_id uuid references public.organic_public_entities(id) on delete restrict,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reference text,
  check ((identity_state='merged' and merged_into_id is not null) or (identity_state<>'merged' and merged_into_id is null)),
  check (identity_state<>'approved' or (reviewed_by_user_id is not null and reviewed_at is not null and review_reference is not null))
);
create table public.organic_public_topics (
  id uuid primary key default gen_random_uuid(),
  intelligence_family text not null check (intelligence_family in (
    'public_market_intelligence','demand_opportunity','company_competitor_intelligence',
    'trend_demand_drift','geography_intelligence','research_data_report')),
  topic_key text not null check (topic_key ~ '^[a-z0-9][a-z0-9._:-]{1,199}$'),
  public_label text not null check (char_length(trim(public_label)) between 2 and 160),
  entity_id uuid references public.organic_public_entities(id) on delete restrict,
  identity_state text not null default 'proposed' check (identity_state in ('proposed','approved','rejected','merged')),
  merged_into_id uuid references public.organic_public_topics(id) on delete restrict,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reference text,
  privacy_state text not null default 'unverified' check (privacy_state in ('approved','blocked','unverified')),
  copyright_state text not null default 'unverified' check (copyright_state in ('aggregate_approved','paraphrase_approved','excerpt_approved','blocked','unverified')),
  safety_reviewed_by_user_id uuid,
  safety_reviewed_at timestamptz,
  safety_review_reference text,
  unique(intelligence_family,topic_key),
  check ((identity_state='merged' and merged_into_id is not null) or (identity_state<>'merged' and merged_into_id is null)),
  check (identity_state<>'approved' or (reviewed_by_user_id is not null and reviewed_at is not null and review_reference is not null)),
  check ((privacy_state='unverified' and copyright_state='unverified' and safety_reviewed_by_user_id is null and safety_reviewed_at is null and safety_review_reference is null)
    or ((privacy_state<>'unverified' or copyright_state<>'unverified') and safety_reviewed_by_user_id is not null
      and safety_reviewed_at is not null and nullif(trim(safety_review_reference),'') is not null))
);
create index organic_public_topics_entity_idx on public.organic_public_topics(entity_id) where entity_id is not null;

create table public.organic_public_viral_events (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.organic_public_topics(id) on delete restrict,
  event_fingerprint text not null check (event_fingerprint ~ '^[a-f0-9]{64}$'),
  identity_basis text not null check (identity_basis in ('provider_root','explicit_repost','explicit_quote','manual_review')),
  state text not null default 'unverified' check (state in ('unverified','verified','rejected','merged')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reference text,
  unique(topic_id,event_fingerprint),
  check (state<>'verified' or (reviewed_by_user_id is not null and reviewed_at is not null and nullif(trim(review_reference),'') is not null))
);
create table public.organic_public_episodes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.organic_public_topics(id) on delete restrict,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete cascade,
  source_evidence_node_id uuid not null references public.evidence_nodes(id) on delete cascade,
  conversation_evidence_node_id uuid not null references public.evidence_nodes(id) on delete cascade,
  provider_key text not null,
  family_key text not null,
  policy_version integer not null check (policy_version>0),
  evidence_scope text not null default 'unknown' check (evidence_scope in ('unknown','context_independent_public','workspace_selected_public','tenant_private','first_party')),
  episode_fingerprint text not null check (episode_fingerprint ~ '^[a-f0-9]{64}$'),
  author_fingerprint text check (author_fingerprint is null or author_fingerprint ~ '^[a-f0-9]{64}$'),
  identity_key_version text not null,
  -- Fingerprints are opaque lineage only. Original author/provider identifiers and body are never copied here.
  thread_fingerprint text check (thread_fingerprint is null or thread_fingerprint ~ '^[a-f0-9]{64}$'),
  content_fingerprint text check (content_fingerprint is null or content_fingerprint ~ '^[a-f0-9]{64}$'),
  url_fingerprint text check (url_fingerprint is null or url_fingerprint ~ '^[a-f0-9]{64}$'),
  safe_source_url text check (safe_source_url is null or safe_source_url ~ '^https://[^/:?#@]+(/[^?#]*)?$'),
  viral_event_id uuid references public.organic_public_viral_events(id) on delete set null,
  identity_state text not null default 'unverified' check (identity_state in ('verified','unverified','duplicate','merged')),
  published_at timestamptz,
  observed_at timestamptz not null,
  last_verified_at timestamptz,
  unique(topic_id,episode_fingerprint),
  foreign key(provider_key,family_key) references public.organic_public_source_policies(provider_key,family_key) on delete restrict,
  check (identity_state<>'verified' or (evidence_scope='context_independent_public' and author_fingerprint is not null and published_at is not null))
);
create index organic_public_episodes_topic_time_idx on public.organic_public_episodes(topic_id,observed_at desc);
create index organic_public_episodes_conversation_idx on public.organic_public_episodes(conversation_id);
create index organic_public_episodes_event_idx on public.organic_public_episodes(viral_event_id) where viral_event_id is not null;
create table public.organic_public_episode_links (
  source_episode_id uuid not null references public.organic_public_episodes(id) on delete cascade,
  target_episode_id uuid not null references public.organic_public_episodes(id) on delete cascade,
  relation_type text not null check (relation_type in ('same_episode','reply_in','repost_of','quote_of','mirror_of','canonical_alias','exact_duplicate')),
  relation_state text not null default 'unverified' check (relation_state in ('unverified','verified','rejected')),
  identity_basis text not null check (identity_basis in ('exact_content_hash','approved_canonical_url','provider_relation','manual_review')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reference text,
  primary key(source_episode_id,target_episode_id,relation_type),
  check(source_episode_id<>target_episode_id),
  check(relation_state<>'verified' or (reviewed_by_user_id is not null and reviewed_at is not null and nullif(trim(review_reference),'') is not null))
);
create index organic_public_episode_links_target_idx on public.organic_public_episode_links(target_episode_id);

create table public.organic_readiness_candidates (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null unique references public.organic_public_topics(id) on delete restrict,
  family_key text not null references public.organic_public_source_families(family_key) on delete restrict,
  canonical_path text not null check (canonical_path ~ '^/(market|demand|companies|trends|markets|research)/[a-z0-9~/-]+$'),
  review_state text not null default 'candidate' check (review_state in ('candidate','eligible','review_required','approved','rejected','stale','merged')),
  search_console_priority text check (search_console_priority is null or search_console_priority in ('not_eligible','search_opportunity','provisional_signal','standard_review','unavailable')),
  eligibility_state text not null default 'evidence_unavailable' check (eligibility_state in (
    'eligible','eligible_review_required','insufficient_evidence','insufficient_diversity','insufficient_persistence','stale',
    'truth_unconfirmed','high_concentration','privacy_blocked','copyright_blocked','duplicate_identity','merged_identity',
    'uniqueness_unverified','freshness_unverified','safety_unverified','evidence_unavailable','noindex')),
  maturity_state text check (maturity_state is null or maturity_state in ('observed','repeated','corroborated','persistent','accelerating','market_level')),
  evaluated_at timestamptz not null,
  evaluator_version text not null,
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  merged_into_id uuid references public.organic_readiness_candidates(id) on delete restrict,
  check ((review_state='merged' and merged_into_id is not null) or (review_state<>'merged' and merged_into_id is null)),
  check (review_state<>'approved' or eligibility_state in ('eligible','eligible_review_required'))
);
create index organic_readiness_candidates_state_time_idx on public.organic_readiness_candidates(review_state,evaluated_at desc);

create table public.organic_readiness_evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.organic_readiness_candidates(id) on delete restrict,
  eligibility_state text not null check (eligibility_state in (
    'eligible','eligible_review_required','insufficient_evidence','insufficient_diversity','insufficient_persistence','stale',
    'truth_unconfirmed','high_concentration','privacy_blocked','copyright_blocked','duplicate_identity','merged_identity',
    'uniqueness_unverified','freshness_unverified','safety_unverified','evidence_unavailable','noindex')),
  maturity_state text,
  independent_episode_count integer check (independent_episode_count is null or independent_episode_count>=0),
  independent_episode_acceleration numeric,
  unique_author_count integer check (unique_author_count is null or unique_author_count>=0),
  source_family_count integer check (source_family_count is null or source_family_count>=0),
  time_bucket_count integer check (time_bucket_count is null or time_bucket_count>=0),
  duplicate_ratio numeric(6,5) check (duplicate_ratio is null or duplicate_ratio between 0 and 1),
  source_concentration numeric(6,5) check (source_concentration is null or source_concentration between 0 and 1),
  viral_event_concentration numeric(6,5) check (viral_event_concentration is null or viral_event_concentration between 0 and 1),
  geography_confidence numeric(6,5) check (geography_confidence is null or geography_confidence between 0 and 1),
  regional_independent_episode_count integer check (regional_independent_episode_count is null or regional_independent_episode_count>=0),
  first_party_supply_confirmed boolean,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  freshness_state text not null default 'unknown' check (freshness_state in ('fresh','stale','unknown')),
  truth_state text not null default 'unknown' check (truth_state in ('confirmed','needs_review','unconfirmed','unknown')),
  safety_state text not null default 'unknown' check (safety_state in ('approved','blocked','unknown')),
  meaningful_updated_at timestamptz,
  blocker_codes text[] not null default '{}',
  evaluated_at timestamptz not null,
  evaluator_version text not null,
  provenance_fingerprint text not null check (provenance_fingerprint ~ '^[a-f0-9]{64}$'),
  unique(candidate_id,id)
);
create index organic_readiness_evaluations_candidate_time_idx on public.organic_readiness_evaluations(candidate_id,evaluated_at desc);
create table public.organic_candidate_evidence (
  candidate_id uuid not null references public.organic_readiness_candidates(id) on delete restrict,
  evaluation_id uuid not null,
  episode_id uuid not null references public.organic_public_episodes(id) on delete cascade,
  contribution_role text not null check (contribution_role in ('independent_support','duplicate','viral_context','geography_support','contradiction')),
  primary key(evaluation_id,episode_id),
  foreign key(candidate_id,evaluation_id) references public.organic_readiness_evaluations(candidate_id,id) on delete restrict
);
create index organic_candidate_evidence_episode_idx on public.organic_candidate_evidence(episode_id);

create table public.organic_candidate_review_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.organic_readiness_candidates(id) on delete restrict,
  admin_audit_event_id uuid not null references public.admin_audit_events(id) on delete restrict,
  actor_user_id uuid not null,
  actor_role text not null check (actor_role='organic_reviewer'),
  action text not null check (action in ('request_review','approve','reject')),
  previous_state text not null,
  next_state text not null,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  check ((action='request_review' and previous_state in ('candidate','eligible') and next_state='review_required')
      or (action='approve' and previous_state='review_required' and next_state='approved')
      or (action='reject' and previous_state='review_required' and next_state='rejected'))
);
create index organic_candidate_review_events_candidate_idx on public.organic_candidate_review_events(candidate_id,created_at desc);

-- Existing Admin roles remain read-only. Review requires a separately provisioned role.
alter table public.admin_memberships drop constraint admin_memberships_role_check;
alter table public.admin_memberships add constraint admin_memberships_role_check
  check (role in ('founder','operations_admin','support','read_only_analyst','organic_reviewer'));
alter table public.admin_audit_events drop constraint admin_audit_events_actor_role_check;
alter table public.admin_audit_events add constraint admin_audit_events_actor_role_check
  check (actor_role in ('founder','operations_admin','support','read_only_analyst','organic_reviewer','system'));

create or replace function public.prevent_organic_candidate_review_event_mutation()
returns trigger language plpgsql set search_path=''
as $$ begin raise exception using errcode='55000',message='organic_candidate_review_events_are_append_only'; end; $$;
create trigger organic_candidate_review_events_append_only
before update or delete on public.organic_candidate_review_events
for each row execute function public.prevent_organic_candidate_review_event_mutation();

create or replace function public.guard_organic_public_episode()
returns trigger language plpgsql set search_path=''
as $$
declare
 p public.organic_public_source_policies%rowtype;
 t public.organic_public_topics%rowtype;
 source_node_workspace uuid;
 source_node_table text;
 source_node_entity uuid;
 source_key text;
 conversation_node_workspace uuid;
 conversation_node_table text;
 conversation_node_entity uuid;
 conversation_source_id uuid;
 conversation_node_id uuid;
 source_evidence_node_id uuid;
 source_kind text;
 viral_topic_id uuid;
 viral_state text;
begin
 select * into p from public.organic_public_source_policies where provider_key=new.provider_key and family_key=new.family_key;
 select f.source_kind into source_kind from public.organic_public_source_families f where f.family_key=new.family_key;
 select * into t from public.organic_public_topics where id=new.topic_id;
 if t.id is null or t.identity_state<>'approved' then raise exception using errcode='23514',message='organic_public_topic_not_approved'; end if;
 if t.privacy_state is distinct from 'approved' or t.copyright_state not in ('aggregate_approved','paraphrase_approved','excerpt_approved')
   or t.safety_reviewed_by_user_id is null or t.safety_reviewed_at is null or nullif(trim(t.safety_review_reference),'') is null then
   raise exception using errcode='23514',message='organic_public_topic_safety_review_not_approved';
 end if;
 if p.provider_key is null or p.policy_state not in ('approved','restricted') or p.context_scope<>'context_independent_public'
   or p.reuse_state not in ('aggregate_only','paraphrase_allowed','excerpt_allowed') or p.policy_version<>new.policy_version then
   raise exception using errcode='23514',message='organic_public_source_policy_not_approved';
 end if;
 if source_kind is distinct from 'third_party' then raise exception using errcode='23514',message='organic_public_source_family_not_independent_demand'; end if;
 if new.evidence_scope<>'context_independent_public' then raise exception using errcode='23514',message='organic_public_evidence_scope_not_eligible'; end if;
 if new.family_key='video_comments' and new.viral_event_id is null then
   raise exception using errcode='23514',message='organic_public_source_family_event_collapse_required';
 end if;
 if new.identity_state='duplicate' and (tg_op<>'UPDATE' or not exists (
   select 1 from public.organic_public_episode_links l where l.relation_state='verified'
     and l.relation_type in ('same_episode','canonical_alias','exact_duplicate','mirror_of')
     and (l.source_episode_id=new.id or l.target_episode_id=new.id)
 )) then raise exception using errcode='23514',message='organic_public_duplicate_relation_not_verified'; end if;
 select s.evidence_node_id,s.source_key,c.evidence_node_id,c.primary_source_item_id
   into source_evidence_node_id,source_key,conversation_node_id,conversation_source_id
   from public.source_items s join public.conversations c on c.id=new.conversation_id
   where s.id=new.source_item_id;
 if source_key is distinct from new.provider_key or conversation_source_id is distinct from new.source_item_id
    or conversation_node_id is distinct from new.conversation_evidence_node_id
    or new.source_evidence_node_id is distinct from source_evidence_node_id then
   raise exception using errcode='23514',message='organic_public_source_provenance_mismatch';
 end if;
 select workspace_id,entity_table,entity_id into source_node_workspace,source_node_table,source_node_entity
   from public.evidence_nodes where id=new.source_evidence_node_id;
 select workspace_id,entity_table,entity_id into conversation_node_workspace,conversation_node_table,conversation_node_entity
   from public.evidence_nodes where id=new.conversation_evidence_node_id;
 if source_node_workspace is not null or source_node_table<>'source_items' or source_node_entity is distinct from new.source_item_id
   or conversation_node_workspace is not null or conversation_node_table<>'conversations' or conversation_node_entity is distinct from new.conversation_id then
   raise exception using errcode='23514',message='organic_public_workspace_evidence_forbidden';
 end if;
 if new.viral_event_id is not null then
   select topic_id,state into viral_topic_id,viral_state from public.organic_public_viral_events where id=new.viral_event_id;
   if viral_topic_id is distinct from new.topic_id or viral_state is distinct from 'verified' then
     raise exception using errcode='23514',message='organic_public_viral_event_not_verified';
   end if;
 end if;
 if new.safe_source_url is not null then
   if p.policy_state<>'approved' or p.canonical_url_use<>'public_attribution' or not ('source_attribution'=any(p.allowed_projection_fields))
      or not exists (
        select 1 from unnest(p.approved_hostnames) h
        where lower(split_part(split_part(new.safe_source_url,'://',2),'/',1))=lower(h)
      ) then
     raise exception using errcode='23514',message='organic_public_source_attribution_not_approved';
   end if;
 end if;
 return new;
end; $$;
create trigger organic_public_episodes_policy_guard before insert or update on public.organic_public_episodes
for each row execute function public.guard_organic_public_episode();

create or replace function public.guard_organic_episode_link()
returns trigger language plpgsql set search_path=''
as $$
declare source_topic uuid; target_topic uuid; source_content text; target_content text; source_url text; target_url text;
begin
 select topic_id,content_fingerprint,url_fingerprint into source_topic,source_content,source_url from public.organic_public_episodes where id=new.source_episode_id;
 select topic_id,content_fingerprint,url_fingerprint into target_topic,target_content,target_url from public.organic_public_episodes where id=new.target_episode_id;
 if source_topic is null or target_topic is distinct from source_topic then raise exception using errcode='23514',message='organic_episode_link_topic_mismatch'; end if;
 if new.relation_state='verified' and new.identity_basis='exact_content_hash' and
    (source_content is null or source_content is distinct from target_content or new.relation_type not in ('same_episode','exact_duplicate')) then
   raise exception using errcode='23514',message='organic_episode_exact_content_identity_mismatch';
 end if;
 if new.relation_state='verified' and new.identity_basis='approved_canonical_url' and
    (source_url is null or source_url is distinct from target_url or new.relation_type not in ('same_episode','canonical_alias','exact_duplicate')) then
   raise exception using errcode='23514',message='organic_episode_canonical_url_identity_mismatch';
 end if;
 if new.relation_state='verified' and new.identity_basis='manual_review' and
    (new.reviewed_by_user_id is null or new.reviewed_at is null or nullif(trim(new.review_reference),'') is null) then
   raise exception using errcode='23514',message='organic_episode_manual_link_review_missing';
 end if;
 return new;
end; $$;
create trigger organic_public_episode_link_guard before insert or update on public.organic_public_episode_links
for each row execute function public.guard_organic_episode_link();

create or replace function public.guard_organic_candidate_identity()
returns trigger language plpgsql set search_path=''
as $$
declare t public.organic_public_topics%rowtype;
begin
 select * into t from public.organic_public_topics where id=new.topic_id;
 if t.id is null or t.identity_state<>'approved' or t.intelligence_family is distinct from new.family_key then
   raise exception using errcode='23514',message='organic_candidate_topic_identity_mismatch';
 end if;
 return new;
end; $$;
create trigger organic_readiness_candidate_identity_guard before insert or update of topic_id,family_key on public.organic_readiness_candidates
for each row execute function public.guard_organic_candidate_identity();

create or replace function public.prevent_organic_candidate_review_state_mutation()
returns trigger language plpgsql set search_path=''
as $$
begin
 if tg_op='INSERT' and new.review_state not in ('candidate','eligible') then
   raise exception using errcode='55000',message='organic_candidate_review_requires_audited_rpc';
 end if;
 if tg_op='UPDATE' then
   if old.review_state is distinct from new.review_state and current_setting('app.organic_candidate_review_transition',true) is distinct from '1' then
     raise exception using errcode='55000',message='organic_candidate_review_requires_audited_rpc';
   end if;
 end if;
 return new;
end; $$;
create trigger organic_readiness_candidate_review_guard before insert or update on public.organic_readiness_candidates
for each row execute function public.prevent_organic_candidate_review_state_mutation();

create or replace function public.invalidate_organic_candidate_topic(p_topic_id uuid,p_cause text)
returns void language plpgsql security definer set search_path=''
as $$
declare c record; request_id uuid:=gen_random_uuid(); previous_transition_setting text:=coalesce(current_setting('app.organic_candidate_review_transition',true),'');
begin
 if p_cause not in ('supporting_public_evidence_removed','source_policy_changed','public_topic_identity_changed','episode_relation_changed') then
   raise exception using errcode='22023',message='organic_candidate_invalidation_reason_invalid';
 end if;
 for c in select id,review_state from public.organic_readiness_candidates where topic_id=p_topic_id and review_state<>'stale' loop
   insert into public.admin_audit_events(actor_user_id,actor_role,action,resource_type,resource_id,reason,request_id,outcome,context)
   values(null,'system','organic_candidate.'||p_cause,'organic_readiness_candidate',c.id::text,
     'A reviewed source, identity, or relation changed; the previous evaluation was invalidated.',request_id::text,'succeeded',
     jsonb_build_object('previous_state',c.review_state,'next_state','stale'));
   perform set_config('app.organic_candidate_review_transition','1',true);
   update public.organic_readiness_candidates set review_state='stale',eligibility_state=
     case when p_cause='supporting_public_evidence_removed' then 'evidence_unavailable'
       when p_cause='source_policy_changed' then 'safety_unverified'
       else 'uniqueness_unverified' end
   where id=c.id;
   perform set_config('app.organic_candidate_review_transition',previous_transition_setting,true);
 end loop;
end; $$;

create or replace function public.mark_organic_candidates_stale_after_evidence_removal()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 perform public.invalidate_organic_candidate_topic(old.topic_id,'supporting_public_evidence_removed');
 return old;
end; $$;
create trigger organic_public_episode_erasure_stales_candidate after delete on public.organic_public_episodes
for each row execute function public.mark_organic_candidates_stale_after_evidence_removal();

create or replace function public.invalidate_candidates_after_source_policy_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare topic_row record;
begin
 if old.policy_state is distinct from new.policy_state or old.context_scope is distinct from new.context_scope
   or old.reuse_state is distinct from new.reuse_state or old.policy_version is distinct from new.policy_version
   or old.allowed_projection_fields is distinct from new.allowed_projection_fields
   or old.raw_conversation_content_use is distinct from new.raw_conversation_content_use
   or old.author_identity_use is distinct from new.author_identity_use
   or old.canonical_url_use is distinct from new.canonical_url_use
   or old.provider_ids_use is distinct from new.provider_ids_use
   or old.timestamps_use is distinct from new.timestamps_use
   or old.evidence_excerpts_use is distinct from new.evidence_excerpts_use
   or old.derived_topics_use is distinct from new.derived_topics_use
   or old.geography_use is distinct from new.geography_use
   or old.company_entity_references_use is distinct from new.company_entity_references_use
   or old.private_connectors_use is distinct from new.private_connectors_use
   or old.workspace_interpretation_use is distinct from new.workspace_interpretation_use
   or old.approved_hostnames is distinct from new.approved_hostnames then
   for topic_row in select distinct topic_id from public.organic_public_episodes where provider_key=new.provider_key loop
     perform public.invalidate_organic_candidate_topic(topic_row.topic_id,'source_policy_changed');
   end loop;
 end if;
 return new;
end; $$;
create trigger organic_public_source_policy_candidate_invalidation after update on public.organic_public_source_policies
for each row execute function public.invalidate_candidates_after_source_policy_change();

create or replace function public.invalidate_candidates_after_topic_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if old.identity_state is distinct from new.identity_state or old.intelligence_family is distinct from new.intelligence_family
   or old.topic_key is distinct from new.topic_key or old.public_label is distinct from new.public_label
   or old.entity_id is distinct from new.entity_id or old.merged_into_id is distinct from new.merged_into_id
   or old.privacy_state is distinct from new.privacy_state or old.copyright_state is distinct from new.copyright_state
   or old.safety_reviewed_by_user_id is distinct from new.safety_reviewed_by_user_id
   or old.safety_reviewed_at is distinct from new.safety_reviewed_at
   or old.safety_review_reference is distinct from new.safety_review_reference then
   perform public.invalidate_organic_candidate_topic(new.id,'public_topic_identity_changed');
 end if;
 return new;
end; $$;
create trigger organic_public_topic_candidate_invalidation after update on public.organic_public_topics
for each row execute function public.invalidate_candidates_after_topic_change();

create or replace function public.invalidate_candidates_after_entity_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare topic_row record;
begin
 if old.entity_key is distinct from new.entity_key or old.entity_type is distinct from new.entity_type
   or old.public_label is distinct from new.public_label or old.identity_state is distinct from new.identity_state
   or old.merged_into_id is distinct from new.merged_into_id then
   for topic_row in select id from public.organic_public_topics where entity_id=new.id loop
     perform public.invalidate_organic_candidate_topic(topic_row.id,'public_topic_identity_changed');
   end loop;
 end if;
 return new;
end; $$;
create trigger organic_public_entity_candidate_invalidation after update on public.organic_public_entities
for each row execute function public.invalidate_candidates_after_entity_change();

create or replace function public.invalidate_candidates_after_episode_relation_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare topic_id_value uuid; episode_id_value uuid;
begin
 if tg_op='DELETE' then episode_id_value:=old.source_episode_id; else episode_id_value:=new.source_episode_id; end if;
 select topic_id into topic_id_value from public.organic_public_episodes where id=episode_id_value;
 if topic_id_value is not null then
   perform public.invalidate_organic_candidate_topic(topic_id_value,'episode_relation_changed');
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger organic_public_episode_link_candidate_invalidation after insert or update or delete on public.organic_public_episode_links
for each row execute function public.invalidate_candidates_after_episode_relation_change();

create or replace function public.invalidate_candidates_after_viral_event_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if tg_op='DELETE' then
   perform public.invalidate_organic_candidate_topic(old.topic_id,'episode_relation_changed');
 elsif old.state is distinct from new.state or old.event_fingerprint is distinct from new.event_fingerprint then
   perform public.invalidate_organic_candidate_topic(new.topic_id,'episode_relation_changed');
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger organic_public_viral_event_candidate_invalidation after update or delete on public.organic_public_viral_events
for each row execute function public.invalidate_candidates_after_viral_event_change();

create or replace function public.invalidate_candidates_after_episode_update()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if tg_op='INSERT' then
   perform public.invalidate_organic_candidate_topic(new.topic_id,'supporting_public_evidence_removed');
   return new;
 end if;
 perform public.invalidate_organic_candidate_topic(old.topic_id,'supporting_public_evidence_removed');
 if new.topic_id is distinct from old.topic_id then
   perform public.invalidate_organic_candidate_topic(new.topic_id,'supporting_public_evidence_removed');
 end if;
 return new;
end; $$;
create trigger organic_public_episode_candidate_invalidation after insert or update on public.organic_public_episodes
for each row execute function public.invalidate_candidates_after_episode_update();

create or replace function public.record_organic_candidate_review(p_candidate_id uuid,p_action text,p_reason text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare a uuid:=auth.uid(); r text; old_state text; eligibility text; latest_evaluation_state text; topic_identity_state text; next_state text; audit_id uuid; request_id uuid:=gen_random_uuid(); previous_transition_setting text:=coalesce(current_setting('app.organic_candidate_review_transition',true),'');
begin
 if a is null or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception using errcode='42501',message='organic_candidate_review_requires_aal2'; end if;
 if char_length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception using errcode='22023',message='organic_candidate_review_reason_required'; end if;
 if p_action is null or p_action not in ('request_review','approve','reject') then raise exception using errcode='22023',message='organic_candidate_review_action_invalid'; end if;
 select role into r from public.admin_memberships where user_id=a and status='active';
 if r is distinct from 'organic_reviewer' then raise exception using errcode='42501',message='organic_candidate_review_membership_required'; end if;
 select c.review_state,c.eligibility_state,t.identity_state into old_state,eligibility,topic_identity_state
   from public.organic_readiness_candidates c join public.organic_public_topics t on t.id=c.topic_id
   where c.id=p_candidate_id for update of c;
 if old_state is null then raise exception using errcode='P0002',message='organic_candidate_not_found'; end if;
 if topic_identity_state is distinct from 'approved' then raise exception using errcode='22023',message='organic_candidate_topic_no_longer_approved'; end if;
 select e.eligibility_state into latest_evaluation_state from public.organic_readiness_evaluations e
   where e.candidate_id=p_candidate_id order by e.evaluated_at desc,e.id desc limit 1;
 if latest_evaluation_state is distinct from eligibility then raise exception using errcode='22023',message='organic_candidate_evaluation_is_stale'; end if;
 if p_action='request_review' then
   if old_state not in ('eligible','candidate') or eligibility not in ('eligible','eligible_review_required') then raise exception using errcode='22023',message='organic_candidate_not_eligible_for_review'; end if;
   next_state:='review_required';
 elsif p_action='approve' then
   if old_state<>'review_required' or eligibility not in ('eligible','eligible_review_required') then raise exception using errcode='22023',message='organic_candidate_approval_requires_current_eligibility'; end if;
   next_state:='approved';
 else
   if old_state<>'review_required' then raise exception using errcode='22023',message='organic_candidate_rejection_requires_review'; end if;
   next_state:='rejected';
 end if;
 insert into public.admin_audit_events(actor_user_id,actor_role,action,resource_type,resource_id,reason,request_id,outcome,context)
 values(a,r,'organic_candidate.'||p_action,'organic_readiness_candidate',p_candidate_id::text,trim(p_reason),request_id::text,'succeeded',
   jsonb_build_object('previous_state',old_state,'next_state',next_state)) returning id into audit_id;
 perform set_config('app.organic_candidate_review_transition','1',true);
 update public.organic_readiness_candidates set review_state=next_state where id=p_candidate_id;
 perform set_config('app.organic_candidate_review_transition',previous_transition_setting,true);
 insert into public.organic_candidate_review_events(candidate_id,admin_audit_event_id,actor_user_id,actor_role,action,previous_state,next_state,reason)
 values(p_candidate_id,audit_id,a,r,p_action,old_state,next_state,trim(p_reason));
 return audit_id;
end; $$;

create or replace function public.organic_public_intelligence_admin_summary()
returns jsonb language sql security invoker set search_path=''
as $$
with active_episodes as (
  select e.* from public.organic_public_episodes e
  join public.organic_public_source_policies p on p.provider_key=e.provider_key and p.family_key=e.family_key
  join public.organic_public_topics t on t.id=e.topic_id
  where p.policy_state in ('approved','restricted') and p.policy_version=e.policy_version and p.context_scope='context_independent_public'
    and t.identity_state='approved' and t.privacy_state='approved'
    and t.copyright_state in ('aggregate_approved','paraphrase_approved','excerpt_approved')
    and t.safety_reviewed_by_user_id is not null and t.safety_reviewed_at is not null and nullif(trim(t.safety_review_reference),'') is not null
    and e.identity_state='verified'
    and e.evidence_scope='context_independent_public' and e.author_fingerprint is not null and e.published_at is not null
), latest_evaluations as (
  select distinct on (e.candidate_id) e.* from public.organic_readiness_evaluations e
  order by e.candidate_id,e.evaluated_at desc,e.id desc
)
select jsonb_build_object(
  'schemaVersion',1,
  'refreshedAt',now(),
  'sourcePolicyStates',(select coalesce(jsonb_object_agg(policy_state,n),'{}'::jsonb) from (select policy_state,count(*)::int n from public.organic_public_source_policies group by policy_state) s),
  'sourceFamilies',(select coalesce(jsonb_object_agg(family_key,n),'{}'::jsonb) from (select family_key,count(*)::int n from public.organic_public_source_policies group by family_key) f),
  'topicStates',(select coalesce(jsonb_object_agg(identity_state,n),'{}'::jsonb) from (select identity_state,count(*)::int n from public.organic_public_topics group by identity_state) t),
  'publicEvidenceRecordCount',(select count(*)::int from active_episodes),
  'verifiedEpisodeCount',(select count(*)::int from active_episodes),
  'authorUnavailableCount',(select count(*)::int from public.organic_public_episodes e join public.organic_public_source_policies p on p.provider_key=e.provider_key and p.family_key=e.family_key where p.policy_state in ('approved','restricted') and p.policy_version=e.policy_version and e.author_fingerprint is null),
  'episodeFamilies',(select coalesce(jsonb_object_agg(family_key,n),'{}'::jsonb) from (select family_key,count(*)::int n from active_episodes group by family_key) ef),
  'episodeFirstPublishedAt',(select min(published_at) from active_episodes),
  'episodeLatestObservedAt',(select max(observed_at) from active_episodes),
  'candidateCount',(select count(*)::int from public.organic_readiness_candidates),
  'candidateReviewStates',(select coalesce(jsonb_object_agg(review_state,n),'{}'::jsonb) from (select review_state,count(*)::int n from public.organic_readiness_candidates group by review_state) cr),
  'candidateEligibilityStates',(select coalesce(jsonb_object_agg(eligibility_state,n),'{}'::jsonb) from (select eligibility_state,count(*)::int n from public.organic_readiness_candidates group by eligibility_state) ce),
  'candidateFamilies',(select coalesce(jsonb_object_agg(family_key,n),'{}'::jsonb) from (select family_key,count(*)::int n from public.organic_readiness_candidates group by family_key) cf),
  'maturityStates',(select coalesce(jsonb_object_agg(maturity_state,n),'{}'::jsonb) from (select maturity_state,count(*)::int n from latest_evaluations where maturity_state is not null group by maturity_state) ms),
  'blockerDistribution',(select coalesce(jsonb_object_agg(code,n),'{}'::jsonb) from (select b.code,count(*)::int n from latest_evaluations e cross join lateral unnest(e.blocker_codes) as b(code) group by b.code) b),
  'staleCount',(select count(*)::int from public.organic_readiness_candidates c left join latest_evaluations e on e.candidate_id=c.id where c.review_state='stale' or e.freshness_state='stale'),
  'mergedDuplicateCount',(select count(*)::int from public.organic_readiness_candidates where review_state='merged' or eligibility_state in ('duplicate_identity','merged_identity')),
  'averageSourceConcentration',(select avg(source_concentration) from latest_evaluations),
  'maximumViralEventConcentration',(select max(viral_event_concentration) from latest_evaluations),
  'lastEvaluatedAt',(select max(evaluated_at) from public.organic_readiness_candidates),
  'reviewEventCount',(select count(*)::int from public.organic_candidate_review_events),
  'candidates',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'publicIntelligenceId',c.topic_id,'label',t.public_label,'family',c.family_key,'reviewState',c.review_state,
    'eligibilityState',c.eligibility_state,'maturityState',le.maturity_state,
    'independentEpisodeCount',le.independent_episode_count,'uniqueAuthorCount',le.unique_author_count,
    'sourceFamilyCount',le.source_family_count,'timeBucketCount',le.time_bucket_count,
    'duplicateRatio',le.duplicate_ratio,'sourceConcentration',le.source_concentration,
    'viralEventConcentration',le.viral_event_concentration,'firstObservedAt',le.first_observed_at,
    'lastObservedAt',le.last_observed_at,'freshnessState',le.freshness_state,
    'truthState',le.truth_state,'safetyState',le.safety_state,
    'searchConsolePriority',c.search_console_priority,'blockerCodes',le.blocker_codes,
    'evaluatedAt',le.evaluated_at,'provenanceEpisodeRefs',coalesce((
      select jsonb_agg(ev.episode_id) from (
        select ce.episode_id from public.organic_candidate_evidence ce
        where ce.candidate_id=c.id and ce.evaluation_id=le.id order by ce.episode_id limit 20
      ) ev
    ),'[]'::jsonb)
  ) order by c.evaluated_at desc),'[]'::jsonb)
   from public.organic_readiness_candidates c
   join public.organic_public_topics t on t.id=c.topic_id
   left join lateral (select e.* from public.organic_readiness_evaluations e where e.candidate_id=c.id order by e.evaluated_at desc,e.id desc limit 1) le on true)
);
$$;
alter table public.organic_public_source_families enable row level security;
alter table public.organic_public_source_policies enable row level security;
alter table public.organic_public_entities enable row level security;
alter table public.organic_public_topics enable row level security;
alter table public.organic_public_viral_events enable row level security;
alter table public.organic_public_episodes enable row level security;
alter table public.organic_public_episode_links enable row level security;
alter table public.organic_readiness_candidates enable row level security;
alter table public.organic_readiness_evaluations enable row level security;
alter table public.organic_candidate_evidence enable row level security;
alter table public.organic_candidate_review_events enable row level security;
revoke all on public.organic_public_source_families,public.organic_public_source_policies,public.organic_public_entities,
 public.organic_public_topics,public.organic_public_viral_events,public.organic_public_episodes,public.organic_public_episode_links,
 public.organic_readiness_candidates,public.organic_readiness_evaluations,public.organic_candidate_evidence,public.organic_candidate_review_events
 from public,anon,authenticated,service_role;
grant select on public.organic_public_source_families to service_role;
grant select,insert,update on public.organic_public_source_policies,public.organic_public_entities,public.organic_public_topics,
 public.organic_public_viral_events,public.organic_public_episodes,public.organic_public_episode_links,public.organic_readiness_candidates to service_role;
grant select,insert on public.organic_readiness_evaluations,public.organic_candidate_evidence to service_role;
grant select on public.organic_candidate_review_events to service_role;
revoke all on function public.organic_public_intelligence_admin_summary() from public,anon,authenticated;
grant execute on function public.organic_public_intelligence_admin_summary() to service_role;
revoke all on function public.prevent_organic_candidate_review_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.guard_organic_public_episode() from public,anon,authenticated,service_role;
revoke all on function public.guard_organic_episode_link() from public,anon,authenticated,service_role;
revoke all on function public.guard_organic_candidate_identity() from public,anon,authenticated,service_role;
revoke all on function public.prevent_organic_candidate_review_state_mutation() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_organic_candidate_topic(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.mark_organic_candidates_stale_after_evidence_removal() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_candidates_after_source_policy_change() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_candidates_after_topic_change() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_candidates_after_entity_change() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_candidates_after_episode_relation_change() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_candidates_after_viral_event_change() from public,anon,authenticated,service_role;
revoke all on function public.invalidate_candidates_after_episode_update() from public,anon,authenticated,service_role;
revoke all on function public.record_organic_candidate_review(uuid,text,text) from public,anon,service_role;
grant execute on function public.record_organic_candidate_review(uuid,text,text) to authenticated;
