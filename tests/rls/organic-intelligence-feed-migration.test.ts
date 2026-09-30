import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/20261103000000_seo26_public_intelligence_feed.sql"), "utf8");
const shareCard = readFileSync(join(root, "supabase/migrations/20261101000000_layer13b1_dynamic_share_card_engine_v1.sql"), "utf8");

describe("SEO-2.6 private public-intelligence schema contract", () => {
  it("starts after the applied production head and creates only empty forward-only structures", () => {
    expect(migration).toContain("20261102000000");
    expect(migration).toContain("raise exception 'seo26_objects_already_exist'");
    expect(migration).not.toMatch(/insert into public\.(conversations|source_items|signals|demand_gaps|demand_drifts)/i);
    expect(migration).not.toMatch(/raw_source_items|workspace_members|action_events|experiment_events/i);
    expect(migration).toContain("source_node_workspace is not null");
    expect(migration).toContain("conversation_node_workspace is not null");
    expect(migration).toContain("organic_public_workspace_evidence_forbidden");
  });

  it("centralizes family mapping and fails closed on unknown source policy", () => {
    expect(migration).toContain("organic_public_source_families");
    expect(migration).toContain("policy_state text not null default 'unknown'");
    expect(migration).toContain("context_scope text not null default 'unknown'");
    expect(migration).toContain("raw_conversation_content_use text not null default 'unknown'");
    expect(migration).toContain("author_identity_use text not null default 'unknown'");
    expect(migration).toContain("private_connectors_use text not null default 'blocked'");
    expect(migration).toContain("workspace_interpretation_use text not null default 'blocked'");
    expect(migration).toContain("policy_state<>'restricted' or");
    expect(migration).toContain("and reuse_state='aggregate_only'");
    expect(migration).toContain("video_comments");
    expect(migration).toContain("organic_public_source_policies(provider_key,family_key)");
    expect(migration).toContain("organic_public_topic_not_approved");
    expect(migration).toContain("organic_public_topic_safety_review_not_approved");
    expect(migration).toContain("safety_reviewed_by_user_id uuid");
    expect(migration).toContain("organic_public_source_policy_not_approved");
    expect(migration).toContain("organic_public_evidence_scope_not_eligible");
    expect(migration).toContain("organic_public_source_family_event_collapse_required");
  });

  it("accepts the registered one-character x provider key", () => {
    expect(migration).toContain("provider_key ~ '^[a-z][a-z0-9_-]{0,79}$'");
    expect(migration).toContain("('x','social_platform')");
  });

  it("keeps global identities and canonical provenance separate from workspace products", () => {
    expect(migration).toContain("organic_public_entities");
    expect(migration).toContain("organic_public_topics");
    expect(migration).toContain("conversation_id uuid not null references public.conversations(id)");
    expect(migration).toContain("source_item_id uuid not null references public.source_items(id)");
    expect(migration).toContain("source_evidence_node_id uuid not null references public.evidence_nodes(id)");
    expect(migration).toContain("conversation_evidence_node_id uuid not null references public.evidence_nodes(id)");
    expect(migration).toContain("exact_duplicate");
    expect(migration).toContain("viral_event_id uuid references public.organic_public_viral_events(id)");
    expect(migration).toContain("intelligence_family text not null check");
    expect(migration).toContain("conversation_source_id is distinct from new.source_item_id");
    expect(migration).toContain("source_node_table<>'source_items'");
    expect(migration).toContain("conversation_node_table<>'conversations'");
    expect(migration).toContain("on delete cascade");
  });

  it("locks every new table to server access and enables RLS", () => {
    expect(migration.match(/enable row level security/g)).toHaveLength(11);
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain("grant select,insert,update on public.organic_public_source_policies");
  });

  it("requires AAL2 and separately provisioned Organic Reviewer membership and audits review atomically", () => {
    expect(migration).toContain("security definer set search_path=''");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("auth.jwt()->>'aal'");
    expect(migration).toContain("organic_candidate_review_requires_aal2");
    expect(migration).toContain("from public.admin_memberships where user_id=a and status='active'");
    expect(migration).toContain("r is distinct from 'organic_reviewer'");
    expect(migration).toContain("role in ('founder','operations_admin','support','read_only_analyst','organic_reviewer')");
    expect(migration).toContain("actor_role in ('founder','operations_admin','support','read_only_analyst','organic_reviewer','system')");
    expect(migration).toContain("old.review_state is distinct from new.review_state");
    expect(migration).toContain("tg_op='INSERT' and new.review_state not in ('candidate','eligible')");
    expect(migration).toContain("before insert or update on public.organic_readiness_candidates");
    expect(migration).toContain("organic_candidate_review_requires_audited_rpc");
    expect(migration).toContain("mark_organic_candidates_stale_after_evidence_removal");
    expect(migration).toContain("organic_candidate.'||p_cause");
    expect(migration).toContain("supporting_public_evidence_removed");
    expect(migration).toContain("insert into public.admin_audit_events");
    expect(migration).toContain("insert into public.organic_candidate_review_events");
    expect(migration).toContain("organic_candidate_review_events_are_append_only");
    expect(migration).toContain("after insert or update on public.organic_public_episodes");
    expect(migration).toContain("organic_public_entity_candidate_invalidation");
    expect(migration).toContain("request_id uuid:=gen_random_uuid()");
    expect(migration).not.toContain("'publish'");

  });

  it("does not allow browser callers to assert verified conversions", () => {
    expect(shareCard).toContain("if p_event_type not in ('opened', 'cta_clicked', 'shared', 'downloaded')");
    expect(shareCard).not.toContain("verified_conversion");
    expect(shareCard).toContain("revoke all on function public.record_share_card_event(text, text, text) from public, anon, authenticated");
  });

  it("exposes only private aggregate summary and safe candidate references to service_role", () => {
    expect(migration).toContain("security invoker set search_path=''");
    expect(migration).toContain("revoke all on function public.organic_public_intelligence_admin_summary() from public,anon,authenticated");
    expect(migration).toContain("grant execute on function public.organic_public_intelligence_admin_summary() to service_role");
    expect(migration).toContain("provenanceEpisodeRefs");
    expect(migration).toContain("t.privacy_state='approved'");
    expect(migration).toContain("t.copyright_state in ('aggregate_approved','paraphrase_approved','excerpt_approved')");
    expect(migration).not.toMatch(/'body'|'authorExternalId'|'providerId'|'rawPayload'/i);
    expect(migration).toContain("grant select on public.organic_candidate_review_events to service_role");
    expect(migration).not.toContain("grant select,insert on public.organic_readiness_evaluations,public.organic_candidate_evidence,public.organic_candidate_review_events");
  });

  it("pins every SECURITY DEFINER helper to an empty search path and revokes browser execution", () => {
    const functionNames = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)\([\s\S]*?security definer set search_path=''/gi)]
      .map((match) => match[1]);
    expect(functionNames.length).toBeGreaterThan(0);
    for (const name of functionNames) {
      expect(migration).toContain(`revoke all on function public.${name}`);
    }
  });
});
