import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import type {
  DemandDriftAlternativeInsert, DemandDriftAlternativeRow, DemandDriftInsert, DemandDriftPhraseInsert,
  DemandDriftPhraseRow, DemandDriftRow, DemandGapInsert, DemandGapRow, DemandObservationInsert,
  DemandObservationRow, DemandSnapshotAlternativeInsert, DemandSnapshotAlternativeRow,
  DemandSnapshotInsert, DemandSnapshotIntentInsert, DemandSnapshotIntentRow, DemandSnapshotPhraseInsert,
  DemandSnapshotPhraseRow, DemandSnapshotRow, DemandSnapshotThemeInsert, DemandSnapshotThemeRow,
  DemandThemeInsert, DemandThemeRow, ThemeMembershipInsert, ThemeMembershipRow,
  Json,
} from "../../db/database.helpers";
import { AppError } from "../../lib/errors";

export interface DemandRepository {
  createObservation(input: DemandObservationInsert): Promise<DemandObservationRow>;
  listObservations(workspaceId: string, productId: string, from?: string, to?: string): Promise<DemandObservationRow[]>;
  createTheme(input: DemandThemeInsert): Promise<DemandThemeRow>;
  listThemes(workspaceId: string, productId: string, demandProfileId?: string, engineVersionId?: string): Promise<DemandThemeRow[]>;
  createMembership(input: ThemeMembershipInsert): Promise<ThemeMembershipRow>;
  listMemberships(workspaceId: string, productId: string, themeId?: string): Promise<ThemeMembershipRow[]>;
  findSnapshotByFingerprint(workspaceId: string, productId: string, fingerprint: string): Promise<DemandSnapshotRow | null>;
  createSnapshot(input: DemandSnapshotInsert): Promise<DemandSnapshotRow>;
  createSnapshotTheme(input: DemandSnapshotThemeInsert): Promise<DemandSnapshotThemeRow>;
  createSnapshotPhrase(input: DemandSnapshotPhraseInsert): Promise<DemandSnapshotPhraseRow>;
  createSnapshotAlternative(input: DemandSnapshotAlternativeInsert): Promise<DemandSnapshotAlternativeRow>;
  createSnapshotIntent(input: DemandSnapshotIntentInsert): Promise<DemandSnapshotIntentRow>;
  listSnapshots(workspaceId: string, productId: string, windowType?: string): Promise<DemandSnapshotRow[]>;
  listSnapshotThemes(snapshotId: string): Promise<DemandSnapshotThemeRow[]>;
  listSnapshotPhrases(snapshotId: string): Promise<DemandSnapshotPhraseRow[]>;
  listSnapshotAlternatives(snapshotId: string): Promise<DemandSnapshotAlternativeRow[]>;
  listSnapshotIntents(snapshotId: string): Promise<DemandSnapshotIntentRow[]>;
  createGap(input: DemandGapInsert): Promise<DemandGapRow>;
  listGaps(workspaceId: string, productId: string, snapshotId?: string): Promise<DemandGapRow[]>;
  createDrift(input: DemandDriftInsert): Promise<DemandDriftRow>;
  createDriftPhrase(input: DemandDriftPhraseInsert): Promise<DemandDriftPhraseRow>;
  createDriftAlternative(input: DemandDriftAlternativeInsert): Promise<DemandDriftAlternativeRow>;
  listDrifts(workspaceId: string, productId: string, currentSnapshotId?: string): Promise<DemandDriftRow[]>;
  listDriftPhrases(currentSnapshotId: string, previousSnapshotId: string): Promise<DemandDriftPhraseRow[]>;
  listDriftAlternatives(currentSnapshotId: string, previousSnapshotId: string): Promise<DemandDriftAlternativeRow[]>;
  linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }): Promise<void>;
}

type DemandClient = SupabaseClient<Database>;

function dbError(error: { message: string; code?: string }, message: string): AppError {
  if (error.code === "23505") return new AppError("CONFLICT", message);
  if (error.code === "42501") return new AppError("FORBIDDEN", "You cannot use this workspace.");
  return new AppError("INTERNAL_ERROR", message, 500, { providerMessage: error.message });
}

export class SupabaseDemandRepository implements DemandRepository {
  constructor(private readonly client: DemandClient) {}

  private async evidence(id: string, nodeType: string, workspaceId: string, entityTable: string, entityId: string) {
    const { error } = await this.client.from("evidence_nodes").upsert({ id, node_type: nodeType, workspace_id: workspaceId, entity_table: entityTable, entity_id: entityId }, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw dbError(error, "Demand evidence anchor could not be stored.");
  }

  private async insert<T>(result: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>, message: string): Promise<T> {
    const { data, error } = await result;
    if (error || !data) throw dbError(error ?? { message: "No row returned." }, message);
    return data;
  }

  async createObservation(input: DemandObservationInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_observation", String(input.workspace_id), "demand_observations", id); return this.insert(this.client.from("demand_observations").insert({ ...input, id }).select("*").single().overrideTypes<DemandObservationRow>(), "Demand observation could not be stored."); }
  async listObservations(workspaceId: string, productId: string, from?: string, to?: string) { let q = this.client.from("demand_observations").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (from) q = q.gte("observed_at", from); if (to) q = q.lt("observed_at", to); const { data, error } = await q.order("observed_at", { ascending: true }); if (error) throw dbError(error, "Demand observations could not be loaded."); return data ?? []; }
  async createTheme(input: DemandThemeInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_theme", String(input.workspace_id), "demand_themes", id); return this.insert(this.client.from("demand_themes").insert({ ...input, id }).select("*").single().overrideTypes<DemandThemeRow>(), "Demand theme could not be stored."); }
  async listThemes(workspaceId: string, productId: string, demandProfileId?: string, engineVersionId?: string) { let q = this.client.from("demand_themes").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (demandProfileId) q = q.eq("demand_profile_id", demandProfileId); if (engineVersionId) q = q.eq("theme_engine_version_id", engineVersionId); const { data, error } = await q.order("theme_key", { ascending: true }); if (error) throw dbError(error, "Demand themes could not be loaded."); return data ?? []; }
  async createMembership(input: ThemeMembershipInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "theme_membership", String(input.workspace_id), "theme_memberships", id); return this.insert(this.client.from("theme_memberships").insert({ ...input, id }).select("*").single().overrideTypes<ThemeMembershipRow>(), "Theme membership could not be stored."); }
  async listMemberships(workspaceId: string, productId: string, themeId?: string) { let q = this.client.from("theme_memberships").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (themeId) q = q.eq("theme_id", themeId); const { data, error } = await q; if (error) throw dbError(error, "Theme memberships could not be loaded."); return data ?? []; }
  async findSnapshotByFingerprint(workspaceId: string, productId: string, fingerprint: string) { const { data, error } = await this.client.from("demand_snapshots").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("input_fingerprint", fingerprint).maybeSingle(); if (error) throw dbError(error, "Demand snapshot could not be loaded."); return data; }
  async createSnapshot(input: DemandSnapshotInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_snapshot", String(input.workspace_id), "demand_snapshots", id); return this.insert(this.client.from("demand_snapshots").insert({ ...input, id }).select("*").single().overrideTypes<DemandSnapshotRow>(), "Demand snapshot could not be stored."); }
  async createSnapshotTheme(input: DemandSnapshotThemeInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_snapshot_theme", String(input.workspace_id), "demand_snapshot_themes", id); return this.insert(this.client.from("demand_snapshot_themes").insert({ ...input, id }).select("*").single().overrideTypes<DemandSnapshotThemeRow>(), "Demand map theme could not be stored."); }
  async createSnapshotPhrase(input: DemandSnapshotPhraseInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_snapshot_phrase", String(input.workspace_id), "demand_snapshot_phrases", id); return this.insert(this.client.from("demand_snapshot_phrases").insert({ ...input, id }).select("*").single().overrideTypes<DemandSnapshotPhraseRow>(), "Demand phrase could not be stored."); }
  async createSnapshotAlternative(input: DemandSnapshotAlternativeInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_snapshot_alternative", String(input.workspace_id), "demand_snapshot_alternatives", id); return this.insert(this.client.from("demand_snapshot_alternatives").insert({ ...input, id }).select("*").single().overrideTypes<DemandSnapshotAlternativeRow>(), "Demand alternative could not be stored."); }
  async createSnapshotIntent(input: DemandSnapshotIntentInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_snapshot_intent", String(input.workspace_id), "demand_snapshot_intents", id); return this.insert(this.client.from("demand_snapshot_intents").insert({ ...input, id }).select("*").single().overrideTypes<DemandSnapshotIntentRow>(), "Demand intent mix could not be stored."); }
  async listSnapshots(workspaceId: string, productId: string, windowType?: string) { let q = this.client.from("demand_snapshots").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (windowType) q = q.eq("window_type", windowType); const { data, error } = await q.order("period_end", { ascending: false }); if (error) throw dbError(error, "Demand snapshots could not be loaded."); return data ?? []; }
  async listSnapshotThemes(snapshotId: string) { const { data, error } = await this.client.from("demand_snapshot_themes").select("*").eq("demand_snapshot_id", snapshotId).order("share_of_demand", { ascending: false }); if (error) throw dbError(error, "Demand map themes could not be loaded."); return data ?? []; }
  async listSnapshotPhrases(snapshotId: string) { const { data, error } = await this.client.from("demand_snapshot_phrases").select("*").eq("demand_snapshot_id", snapshotId).order("mention_count", { ascending: false }); if (error) throw dbError(error, "Demand phrases could not be loaded."); return data ?? []; }
  async listSnapshotAlternatives(snapshotId: string) { const { data, error } = await this.client.from("demand_snapshot_alternatives").select("*").eq("demand_snapshot_id", snapshotId).order("mention_count", { ascending: false }); if (error) throw dbError(error, "Demand alternatives could not be loaded."); return data ?? []; }
  async listSnapshotIntents(snapshotId: string) { const { data, error } = await this.client.from("demand_snapshot_intents").select("*").eq("demand_snapshot_id", snapshotId).order("mention_count", { ascending: false }); if (error) throw dbError(error, "Demand intents could not be loaded."); return data ?? []; }
  async createGap(input: DemandGapInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_gap", String(input.workspace_id), "demand_gaps", id); return this.insert(this.client.from("demand_gaps").insert({ ...input, id }).select("*").single().overrideTypes<DemandGapRow>(), "Demand gap could not be stored."); }
  async listGaps(workspaceId: string, productId: string, snapshotId?: string) { let q = this.client.from("demand_gaps").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (snapshotId) q = q.eq("demand_snapshot_id", snapshotId); const { data, error } = await q.order("gap_score", { ascending: false }); if (error) throw dbError(error, "Demand gaps could not be loaded."); return data ?? []; }
  async createDrift(input: DemandDriftInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_drift", String(input.workspace_id), "demand_drifts", id); return this.insert(this.client.from("demand_drifts").insert({ ...input, id }).select("*").single().overrideTypes<DemandDriftRow>(), "Demand drift could not be stored."); }
  async createDriftPhrase(input: DemandDriftPhraseInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_drift_phrase", String(input.workspace_id), "demand_drift_phrases", id); return this.insert(this.client.from("demand_drift_phrases").insert({ ...input, id }).select("*").single().overrideTypes<DemandDriftPhraseRow>(), "Phrase drift could not be stored."); }
  async createDriftAlternative(input: DemandDriftAlternativeInsert) { const id = input.id ?? crypto.randomUUID(); await this.evidence(String(input.evidence_node_id), "demand_drift_alternative", String(input.workspace_id), "demand_drift_alternatives", id); return this.insert(this.client.from("demand_drift_alternatives").insert({ ...input, id }).select("*").single().overrideTypes<DemandDriftAlternativeRow>(), "Alternative drift could not be stored."); }
  async listDrifts(workspaceId: string, productId: string, currentSnapshotId?: string) { let q = this.client.from("demand_drifts").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (currentSnapshotId) q = q.eq("current_snapshot_id", currentSnapshotId); const { data, error } = await q.order("share_delta", { ascending: false }); if (error) throw dbError(error, "Demand drifts could not be loaded."); return data ?? []; }
  async listDriftPhrases(currentSnapshotId: string, previousSnapshotId: string) { const { data, error } = await this.client.from("demand_drift_phrases").select("*").eq("current_snapshot_id", currentSnapshotId).eq("previous_snapshot_id", previousSnapshotId); if (error) throw dbError(error, "Phrase drifts could not be loaded."); return data ?? []; }
  async listDriftAlternatives(currentSnapshotId: string, previousSnapshotId: string) { const { data, error } = await this.client.from("demand_drift_alternatives").select("*").eq("current_snapshot_id", currentSnapshotId).eq("previous_snapshot_id", previousSnapshotId); if (error) throw dbError(error, "Alternative drifts could not be loaded."); return data ?? []; }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }) { const { error } = await this.client.from("evidence_provenance").upsert({ derived_evidence_node_id: input.derivedEvidenceNodeId, source_evidence_node_id: input.sourceEvidenceNodeId, relation_type: input.relationType, weight: input.weight, ordinal: input.ordinal, span: input.span ?? null, measurement: input.measurement ?? null, engine_version_id: input.engineVersionId ?? null }, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true }); if (error) throw dbError(error, "Demand provenance could not be stored."); }
}

function timestamp(): string { return new Date().toISOString(); }
function row<T extends { id: string; workspace_id: string; created_at: string }>(input: Partial<T>, defaults: Partial<T> = {}): T { return { ...defaults, ...input, id: input.id ?? crypto.randomUUID(), workspace_id: input.workspace_id ?? "", created_at: input.created_at ?? timestamp() } as T; }

export class InMemoryDemandRepository implements DemandRepository {
  readonly observations = new Map<string, DemandObservationRow>();
  readonly themes = new Map<string, DemandThemeRow>();
  readonly memberships = new Map<string, ThemeMembershipRow>();
  readonly snapshots = new Map<string, DemandSnapshotRow>();
  readonly snapshotThemes = new Map<string, DemandSnapshotThemeRow>();
  readonly snapshotPhrases = new Map<string, DemandSnapshotPhraseRow>();
  readonly snapshotAlternatives = new Map<string, DemandSnapshotAlternativeRow>();
  readonly snapshotIntents = new Map<string, DemandSnapshotIntentRow>();
  readonly gaps = new Map<string, DemandGapRow>();
  readonly drifts = new Map<string, DemandDriftRow>();
  readonly driftPhrases = new Map<string, DemandDriftPhraseRow>();
  readonly driftAlternatives = new Map<string, DemandDriftAlternativeRow>();
  readonly provenance: Array<{ derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }> = [];

  async createObservation(input: DemandObservationInsert) { const existing = [...this.observations.values()].find((r) => r.workspace_id === input.workspace_id && r.product_id === input.product_id && r.match_evaluation_id === input.match_evaluation_id && r.observation_engine_version_id === input.observation_engine_version_id && r.observation_type === input.observation_type && r.normalized_value === input.normalized_value && r.facet_value === input.facet_value); if (existing) return existing; const value = row<DemandObservationRow>(input); this.observations.set(value.id, value); return value; }
  async listObservations(workspaceId: string, productId: string, from?: string, to?: string) { return [...this.observations.values()].filter((r) => r.workspace_id === workspaceId && r.product_id === productId && (!from || r.observed_at >= from) && (!to || r.observed_at < to)).sort((a, b) => a.observed_at.localeCompare(b.observed_at)); }
  async createTheme(input: DemandThemeInsert) { const existing = [...this.themes.values()].find((r) => r.workspace_id === input.workspace_id && r.product_id === input.product_id && r.demand_profile_id === input.demand_profile_id && r.theme_engine_version_id === input.theme_engine_version_id && r.theme_key === input.theme_key); if (existing) return existing; const value = row<DemandThemeRow>(input); this.themes.set(value.id, value); return value; }
  async listThemes(workspaceId: string, productId: string, demandProfileId?: string, engineVersionId?: string) { return [...this.themes.values()].filter((r) => r.workspace_id === workspaceId && r.product_id === productId && (!demandProfileId || r.demand_profile_id === demandProfileId) && (!engineVersionId || r.theme_engine_version_id === engineVersionId)); }
  async createMembership(input: ThemeMembershipInsert) { const existing = [...this.memberships.values()].find((r) => r.theme_id === input.theme_id && r.observation_id === input.observation_id && r.theme_engine_version_id === input.theme_engine_version_id); if (existing) return existing; const value = row<ThemeMembershipRow>(input); this.memberships.set(value.id, value); return value; }
  async listMemberships(workspaceId: string, productId: string, themeId?: string) { return [...this.memberships.values()].filter((r) => r.workspace_id === workspaceId && r.product_id === productId && (!themeId || r.theme_id === themeId)); }
  async findSnapshotByFingerprint(workspaceId: string, productId: string, fingerprint: string) { return [...this.snapshots.values()].find((r) => r.workspace_id === workspaceId && r.product_id === productId && r.input_fingerprint === fingerprint) ?? null; }
  async createSnapshot(input: DemandSnapshotInsert) { const existing = await this.findSnapshotByFingerprint(String(input.workspace_id), String(input.product_id), String(input.input_fingerprint)); if (existing) return existing; const value = row<DemandSnapshotRow>(input); this.snapshots.set(value.id, value); return value; }
  async createSnapshotTheme(input: DemandSnapshotThemeInsert) { const existing = [...this.snapshotThemes.values()].find((r) => r.demand_snapshot_id === input.demand_snapshot_id && r.theme_key === input.theme_key); if (existing) return existing; const value = row<DemandSnapshotThemeRow>(input); this.snapshotThemes.set(value.id, value); return value; }
  async createSnapshotPhrase(input: DemandSnapshotPhraseInsert) { const existing = [...this.snapshotPhrases.values()].find((r) => r.demand_snapshot_id === input.demand_snapshot_id && r.phrase_type === input.phrase_type && r.normalized_value === input.normalized_value && r.phrase === input.phrase); if (existing) return existing; const value = row<DemandSnapshotPhraseRow>(input); this.snapshotPhrases.set(value.id, value); return value; }
  async createSnapshotAlternative(input: DemandSnapshotAlternativeInsert) { const existing = [...this.snapshotAlternatives.values()].find((r) => r.demand_snapshot_id === input.demand_snapshot_id && r.normalized_value === input.normalized_value && r.alternative === input.alternative); if (existing) return existing; const value = row<DemandSnapshotAlternativeRow>(input); this.snapshotAlternatives.set(value.id, value); return value; }
  async createSnapshotIntent(input: DemandSnapshotIntentInsert) { const existing = [...this.snapshotIntents.values()].find((r) => r.demand_snapshot_id === input.demand_snapshot_id && r.intent_type === input.intent_type); if (existing) return existing; const value = row<DemandSnapshotIntentRow>(input); this.snapshotIntents.set(value.id, value); return value; }
  async listSnapshots(workspaceId: string, productId: string, windowType?: string) { return [...this.snapshots.values()].filter((r) => r.workspace_id === workspaceId && r.product_id === productId && (!windowType || r.window_type === windowType)).sort((a, b) => b.period_end.localeCompare(a.period_end)); }
  async listSnapshotThemes(snapshotId: string) { return [...this.snapshotThemes.values()].filter((r) => r.demand_snapshot_id === snapshotId).sort((a, b) => b.share_of_demand - a.share_of_demand); }
  async listSnapshotPhrases(snapshotId: string) { return [...this.snapshotPhrases.values()].filter((r) => r.demand_snapshot_id === snapshotId).sort((a, b) => b.mention_count - a.mention_count); }
  async listSnapshotAlternatives(snapshotId: string) { return [...this.snapshotAlternatives.values()].filter((r) => r.demand_snapshot_id === snapshotId).sort((a, b) => b.mention_count - a.mention_count); }
  async listSnapshotIntents(snapshotId: string) { return [...this.snapshotIntents.values()].filter((r) => r.demand_snapshot_id === snapshotId).sort((a, b) => b.mention_count - a.mention_count); }
  async createGap(input: DemandGapInsert) { const existing = [...this.gaps.values()].find((r) => r.workspace_id === input.workspace_id && r.demand_snapshot_id === input.demand_snapshot_id && r.product_snapshot_id === input.product_snapshot_id && r.concept_key === input.concept_key && r.gap_engine_version_id === input.gap_engine_version_id && r.input_fingerprint === input.input_fingerprint); if (existing) return existing; const value = row<DemandGapRow>(input); this.gaps.set(value.id, value); return value; }
  async listGaps(workspaceId: string, productId: string, snapshotId?: string) { return [...this.gaps.values()].filter((r) => r.workspace_id === workspaceId && r.product_id === productId && (!snapshotId || r.demand_snapshot_id === snapshotId)).sort((a, b) => b.gap_score - a.gap_score); }
  async createDrift(input: DemandDriftInsert) { const existing = [...this.drifts.values()].find((r) => r.workspace_id === input.workspace_id && r.current_snapshot_id === input.current_snapshot_id && r.previous_snapshot_id === input.previous_snapshot_id && r.concept_key === input.concept_key && r.drift_engine_version_id === input.drift_engine_version_id && r.input_fingerprint === input.input_fingerprint); if (existing) return existing; const value = row<DemandDriftRow>(input); this.drifts.set(value.id, value); return value; }
  async createDriftPhrase(input: DemandDriftPhraseInsert) { const existing = [...this.driftPhrases.values()].find((r) => r.current_snapshot_id === input.current_snapshot_id && r.previous_snapshot_id === input.previous_snapshot_id && r.normalized_value === input.normalized_value && r.phrase === input.phrase); if (existing) return existing; const value = row<DemandDriftPhraseRow>(input); this.driftPhrases.set(value.id, value); return value; }
  async createDriftAlternative(input: DemandDriftAlternativeInsert) { const existing = [...this.driftAlternatives.values()].find((r) => r.current_snapshot_id === input.current_snapshot_id && r.previous_snapshot_id === input.previous_snapshot_id && r.normalized_value === input.normalized_value && r.alternative === input.alternative); if (existing) return existing; const value = row<DemandDriftAlternativeRow>(input); this.driftAlternatives.set(value.id, value); return value; }
  async listDrifts(workspaceId: string, productId: string, currentSnapshotId?: string) { return [...this.drifts.values()].filter((r) => r.workspace_id === workspaceId && r.product_id === productId && (!currentSnapshotId || r.current_snapshot_id === currentSnapshotId)).sort((a, b) => b.share_delta - a.share_delta); }
  async listDriftPhrases(currentSnapshotId: string, previousSnapshotId: string) { return [...this.driftPhrases.values()].filter((r) => r.current_snapshot_id === currentSnapshotId && r.previous_snapshot_id === previousSnapshotId); }
  async listDriftAlternatives(currentSnapshotId: string, previousSnapshotId: string) { return [...this.driftAlternatives.values()].filter((r) => r.current_snapshot_id === currentSnapshotId && r.previous_snapshot_id === previousSnapshotId); }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }) { if (!this.provenance.some((edge) => edge.derivedEvidenceNodeId === input.derivedEvidenceNodeId && edge.sourceEvidenceNodeId === input.sourceEvidenceNodeId && edge.relationType === input.relationType && edge.ordinal === input.ordinal)) this.provenance.push(input); }
}
