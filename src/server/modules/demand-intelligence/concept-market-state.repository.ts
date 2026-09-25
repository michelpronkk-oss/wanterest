import type { Json } from "../../db/database.helpers";

/**
 * Wanterest Layer 9C persistence port. Every read and write is scoped by the
 * caller's (workspaceId, productId); PostgreSQL composite FKs reject
 * cross-product rows. Service-role only (Trigger rebuild path). See
 * docs/architecture.md Section 18.
 */

export type ConceptMarketStateRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  evidence_node_id: string;
  clustering_version: string;
  anchor_concept_key: string;
  concept_market_state_policy_version: string;
  market_state_engine_version_id: string;
  previous_state_id: string | null;
  sequence: number;
  input_fingerprint: string;
  strength_level: string;
  distinct_evidence_count: number;
  distinct_source_count: number;
  contributing_membership_count: number;
  excluded_membership_count: number;
  source_mix: Json;
  intent_family_mix: Json;
  target_scope_mix: Json;
  exclusions: Json;
  first_evidence_at: string | null;
  last_evidence_at: string | null;
  computed_at: string;
  created_at: string;
};

export type ConceptGapStateRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  evidence_node_id: string;
  clustering_version: string;
  anchor_concept_key: string;
  gap_state_policy_version: string;
  gap_engine_version_id: string;
  market_state_id: string;
  product_snapshot_id: string;
  previous_state_id: string | null;
  sequence: number;
  input_fingerprint: string;
  status: string;
  share_of_current_demand: number;
  positioning_weight: number;
  high_intent_share: number;
  sample_quality: string;
  gap_score: number | null;
  computed_at: string;
  created_at: string;
};

export type ConceptDriftStateRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  evidence_node_id: string;
  clustering_version: string;
  anchor_concept_key: string;
  drift_state_policy_version: string;
  comparability_version: string;
  drift_engine_version_id: string;
  window_type: string;
  market_state_id: string;
  previous_state_id: string | null;
  sequence: number;
  input_fingerprint: string;
  comparable: boolean;
  comparability_reason: string | null;
  monitoring_started_at_basis: string | null;
  previous_period_start: string | null;
  previous_period_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  current_frozen_evidence_count: number | null;
  previous_frozen_evidence_count: number | null;
  current_frozen_source_count: number | null;
  previous_frozen_source_count: number | null;
  direction: string | null;
  significance: string | null;
  share_delta: number | null;
  growth_rate: number | null;
  computed_at: string;
  created_at: string;
};

type Insert<T extends { created_at: string }> = Omit<T, "created_at">;
export type ConceptMarketStateInsert = Insert<ConceptMarketStateRow>;
export type ConceptGapStateInsert = Insert<ConceptGapStateRow>;
export type ConceptDriftStateInsert = Insert<ConceptDriftStateRow>;

export type ConceptProvenanceEdge = {
  derivedEvidenceNodeId: string;
  sourceEvidenceNodeId: string;
  relationType: string;
  weight?: number;
  ordinal?: number;
  measurement?: Json | null;
  engineVersionId?: string | null;
};

export interface ConceptMarketStateRepository {
  latestMarketState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string): Promise<ConceptMarketStateRow | null>;
  /** Batched: latest market state per concept for the whole product, one read. */
  listLatestMarketStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string): Promise<ConceptMarketStateRow[]>;
  /** Idempotent: an existing row with the same natural key is returned unchanged. */
  createMarketState(input: ConceptMarketStateInsert): Promise<ConceptMarketStateRow>;

  latestGapState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string): Promise<ConceptGapStateRow | null>;
  listLatestGapStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string): Promise<ConceptGapStateRow[]>;
  createGapState(input: ConceptGapStateInsert): Promise<ConceptGapStateRow>;

  latestDriftState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string, window: string): Promise<ConceptDriftStateRow | null>;
  listLatestDriftStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string, window: string): Promise<ConceptDriftStateRow[]>;
  createDriftState(input: ConceptDriftStateInsert): Promise<ConceptDriftStateRow>;

  linkProvenance(edge: ConceptProvenanceEdge): Promise<void>;
}

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type Result<T> = PromiseLike<{ data: T; error: ErrorResult }>;
type Filterable = Result<Row[] | null> & {
  eq(field: string, value: unknown): Filterable;
  order(field: string, options: { ascending: boolean }): Filterable;
  limit(count: number): Filterable;
};
type Query = {
  select(columns: string): Filterable;
  insert(row: Row): { select(columns: string): { single(): Result<Row | null> } };
  upsert(row: Row, options: { onConflict: string; ignoreDuplicates: boolean }): Result<null>;
};
type Client = { from(table: string): Query };

function persistenceError(error: ErrorResult, context: string): Error {
  const code = error?.code ? ` (${error.code})` : "";
  const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
  return new Error(`Concept market state persistence failed during ${context}${code}${message}`);
}

export class SupabaseConceptMarketStateRepository implements ConceptMarketStateRepository {
  constructor(private readonly client: unknown) {}

  private table(name: string): Query {
    return (this.client as Client).from(name);
  }

  private async rows(query: Filterable, context: string): Promise<Row[]> {
    const { data, error } = await query;
    if (error) throw persistenceError(error, context);
    return data ?? [];
  }

  private async evidenceNode(id: string, nodeType: string, workspaceId: string, entityTable: string, entityId: string) {
    const { error } = await this.table("evidence_nodes").upsert({ id, node_type: nodeType, workspace_id: workspaceId, entity_table: entityTable, entity_id: entityId }, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw persistenceError(error, `${nodeType} evidence anchor`);
  }

  async latestMarketState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string) {
    const rows = await this.rows(this.table("concept_market_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).eq("anchor_concept_key", anchorConceptKey).eq("concept_market_state_policy_version", policyVersion).order("sequence", { ascending: false }).limit(1), "latest market state lookup");
    return (rows[0] as ConceptMarketStateRow | undefined) ?? null;
  }

  async listLatestMarketStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string) {
    const rows = await this.rows(this.table("concept_market_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).eq("concept_market_state_policy_version", policyVersion).order("sequence", { ascending: false }), "latest market states batch lookup") as ConceptMarketStateRow[];
    return latestPerKey(rows, (row) => row.anchor_concept_key);
  }

  async createMarketState(input: ConceptMarketStateInsert) {
    await this.evidenceNode(input.evidence_node_id, "concept_market_state", input.workspace_id, "concept_market_states", input.id);
    const { data, error } = await this.table("concept_market_states").insert(input as unknown as Row).select("*").single();
    if (!error && data) return data as ConceptMarketStateRow;
    if (error?.code !== "23505") throw persistenceError(error, "market state insert");
    const existing = await this.latestMarketState(input.workspace_id, input.product_id, input.clustering_version, input.anchor_concept_key, input.concept_market_state_policy_version);
    if (!existing || existing.sequence !== input.sequence) throw persistenceError(error, "market state conflict resolution");
    return existing;
  }

  async latestGapState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string) {
    const rows = await this.rows(this.table("concept_gap_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).eq("anchor_concept_key", anchorConceptKey).eq("gap_state_policy_version", policyVersion).order("sequence", { ascending: false }).limit(1), "latest gap state lookup");
    return (rows[0] as ConceptGapStateRow | undefined) ?? null;
  }

  async listLatestGapStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string) {
    const rows = await this.rows(this.table("concept_gap_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).eq("gap_state_policy_version", policyVersion).order("sequence", { ascending: false }), "latest gap states batch lookup") as ConceptGapStateRow[];
    return latestPerKey(rows, (row) => row.anchor_concept_key);
  }

  async createGapState(input: ConceptGapStateInsert) {
    await this.evidenceNode(input.evidence_node_id, "concept_gap_state", input.workspace_id, "concept_gap_states", input.id);
    const { data, error } = await this.table("concept_gap_states").insert(input as unknown as Row).select("*").single();
    if (!error && data) return data as ConceptGapStateRow;
    if (error?.code !== "23505") throw persistenceError(error, "gap state insert");
    const existing = await this.latestGapState(input.workspace_id, input.product_id, input.clustering_version, input.anchor_concept_key, input.gap_state_policy_version);
    if (!existing || existing.sequence !== input.sequence) throw persistenceError(error, "gap state conflict resolution");
    return existing;
  }

  async latestDriftState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string, window: string) {
    const rows = await this.rows(this.table("concept_drift_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).eq("anchor_concept_key", anchorConceptKey).eq("drift_state_policy_version", policyVersion).eq("window_type", window).order("sequence", { ascending: false }).limit(1), "latest drift state lookup");
    return (rows[0] as ConceptDriftStateRow | undefined) ?? null;
  }

  async listLatestDriftStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string, window: string) {
    const rows = await this.rows(this.table("concept_drift_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).eq("drift_state_policy_version", policyVersion).eq("window_type", window).order("sequence", { ascending: false }), "latest drift states batch lookup") as ConceptDriftStateRow[];
    return latestPerKey(rows, (row) => row.anchor_concept_key);
  }

  async createDriftState(input: ConceptDriftStateInsert) {
    await this.evidenceNode(input.evidence_node_id, "concept_drift_state", input.workspace_id, "concept_drift_states", input.id);
    const { data, error } = await this.table("concept_drift_states").insert(input as unknown as Row).select("*").single();
    if (!error && data) return data as ConceptDriftStateRow;
    if (error?.code !== "23505") throw persistenceError(error, "drift state insert");
    const existing = await this.latestDriftState(input.workspace_id, input.product_id, input.clustering_version, input.anchor_concept_key, input.drift_state_policy_version, input.window_type);
    if (!existing || existing.sequence !== input.sequence) throw persistenceError(error, "drift state conflict resolution");
    return existing;
  }

  async linkProvenance(edge: ConceptProvenanceEdge) {
    const { error } = await this.table("evidence_provenance").upsert({ derived_evidence_node_id: edge.derivedEvidenceNodeId, source_evidence_node_id: edge.sourceEvidenceNodeId, relation_type: edge.relationType, weight: edge.weight ?? null, ordinal: edge.ordinal ?? null, span: null, measurement: edge.measurement ?? null, engine_version_id: edge.engineVersionId ?? null }, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true });
    if (error) throw persistenceError(error, "provenance link");
  }
}

function latestPerKey<T extends { sequence: number }>(rows: T[], keyOf: (row: T) => string): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = latest.get(key);
    if (!current || row.sequence > current.sequence) latest.set(key, row);
  }
  return [...latest.values()];
}

/** In-memory implementation for tests and fixtures, mirroring the migration's natural keys. */
export class InMemoryConceptMarketStateRepository implements ConceptMarketStateRepository {
  readonly marketStates = new Map<string, ConceptMarketStateRow>();
  readonly gapStates = new Map<string, ConceptGapStateRow>();
  readonly driftStates = new Map<string, ConceptDriftStateRow>();
  readonly provenance: ConceptProvenanceEdge[] = [];
  private clock = 0;

  private stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 8, 1) + this.clock).toISOString();
  }

  private marketStatesFor(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string) {
    return [...this.marketStates.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion && row.anchor_concept_key === anchorConceptKey && row.concept_market_state_policy_version === policyVersion).sort((left, right) => left.sequence - right.sequence);
  }

  async latestMarketState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string) {
    return this.marketStatesFor(workspaceId, productId, clusteringVersion, anchorConceptKey, policyVersion).at(-1) ?? null;
  }

  async listLatestMarketStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string) {
    const rows = [...this.marketStates.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion && row.concept_market_state_policy_version === policyVersion);
    return latestPerKey(rows, (row) => row.anchor_concept_key);
  }

  async createMarketState(input: ConceptMarketStateInsert) {
    const existing = [...this.marketStates.values()].find((row) => row.workspace_id === input.workspace_id && row.product_id === input.product_id && row.clustering_version === input.clustering_version && row.anchor_concept_key === input.anchor_concept_key && row.concept_market_state_policy_version === input.concept_market_state_policy_version && row.sequence === input.sequence);
    if (existing) return existing;
    const row = { ...input, created_at: this.stamp() };
    this.marketStates.set(row.id, row);
    return row;
  }

  private gapStatesFor(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string) {
    return [...this.gapStates.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion && row.anchor_concept_key === anchorConceptKey && row.gap_state_policy_version === policyVersion).sort((left, right) => left.sequence - right.sequence);
  }

  async latestGapState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string) {
    return this.gapStatesFor(workspaceId, productId, clusteringVersion, anchorConceptKey, policyVersion).at(-1) ?? null;
  }

  async listLatestGapStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string) {
    const rows = [...this.gapStates.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion && row.gap_state_policy_version === policyVersion);
    return latestPerKey(rows, (row) => row.anchor_concept_key);
  }

  async createGapState(input: ConceptGapStateInsert) {
    const market = this.marketStates.get(input.market_state_id);
    if (!market || market.workspace_id !== input.workspace_id || market.product_id !== input.product_id) throw new Error("foreign key violation: concept_gap_states -> concept_market_states (workspace_id, product_id, id)");
    const existing = [...this.gapStates.values()].find((row) => row.workspace_id === input.workspace_id && row.product_id === input.product_id && row.clustering_version === input.clustering_version && row.anchor_concept_key === input.anchor_concept_key && row.gap_state_policy_version === input.gap_state_policy_version && row.sequence === input.sequence);
    if (existing) return existing;
    const row = { ...input, created_at: this.stamp() };
    this.gapStates.set(row.id, row);
    return row;
  }

  private driftStatesFor(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string, window: string) {
    return [...this.driftStates.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion && row.anchor_concept_key === anchorConceptKey && row.drift_state_policy_version === policyVersion && row.window_type === window).sort((left, right) => left.sequence - right.sequence);
  }

  async latestDriftState(workspaceId: string, productId: string, clusteringVersion: string, anchorConceptKey: string, policyVersion: string, window: string) {
    return this.driftStatesFor(workspaceId, productId, clusteringVersion, anchorConceptKey, policyVersion, window).at(-1) ?? null;
  }

  async listLatestDriftStates(workspaceId: string, productId: string, clusteringVersion: string, policyVersion: string, window: string) {
    const rows = [...this.driftStates.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion && row.drift_state_policy_version === policyVersion && row.window_type === window);
    return latestPerKey(rows, (row) => row.anchor_concept_key);
  }

  async createDriftState(input: ConceptDriftStateInsert) {
    const market = this.marketStates.get(input.market_state_id);
    if (!market || market.workspace_id !== input.workspace_id || market.product_id !== input.product_id) throw new Error("foreign key violation: concept_drift_states -> concept_market_states (workspace_id, product_id, id)");
    const existing = [...this.driftStates.values()].find((row) => row.workspace_id === input.workspace_id && row.product_id === input.product_id && row.clustering_version === input.clustering_version && row.anchor_concept_key === input.anchor_concept_key && row.drift_state_policy_version === input.drift_state_policy_version && row.window_type === input.window_type && row.sequence === input.sequence);
    if (existing) return existing;
    const row = { ...input, created_at: this.stamp() };
    this.driftStates.set(row.id, row);
    return row;
  }

  async linkProvenance(edge: ConceptProvenanceEdge) {
    if (!this.provenance.some((item) => item.derivedEvidenceNodeId === edge.derivedEvidenceNodeId && item.sourceEvidenceNodeId === edge.sourceEvidenceNodeId && item.relationType === edge.relationType && item.ordinal === edge.ordinal)) this.provenance.push(edge);
  }
}
