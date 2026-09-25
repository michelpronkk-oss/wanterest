import type { Json } from "../../db/database.helpers";

/**
 * Wanterest 1B Stage 2G persistence port. Every read and write is filtered by
 * workspace_id AND product_id supplied by the server-side caller (never by a
 * browser), and PostgreSQL composite foreign keys reject cross-product rows.
 * The Supabase implementation is service-role only (scan / Trigger paths).
 */

export type DemandClusterRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  evidence_node_id: string;
  clustering_version: string;
  clustering_engine_version_id: string;
  cluster_key: string;
  anchor_concept_key: string;
  intent_family: string;
  target_scope: string;
  label: string;
  identity: Json;
  created_at: string;
};

export type DemandClusterMembershipRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  cluster_id: string;
  match_evaluation_id: string;
  product_match_id: string;
  conversation_id: string;
  evidence_node_id: string;
  clustering_version: string;
  clustering_engine_version_id: string;
  source_key: string;
  evidence_at: string;
  confidence: number;
  assignment: Json;
  created_at: string;
};

export type DemandClusterStateRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  cluster_id: string;
  previous_state_id: string | null;
  evidence_node_id: string;
  strength_version: string;
  clustering_engine_version_id: string;
  sequence: number;
  input_fingerprint: string;
  strength_level: string;
  strength_score: number;
  distinct_evidence_count: number;
  distinct_source_count: number;
  contributing_membership_count: number;
  excluded_membership_count: number;
  average_demand_quality: number;
  average_confidence: number;
  components: Json;
  source_mix: Json;
  intent_mix: Json;
  alternative_mix: Json;
  lifecycle_mix: Json;
  exclusions: Json;
  first_evidence_at: string | null;
  last_evidence_at: string | null;
  stale_before: string;
  computed_at: string;
  created_at: string;
};

type Insert<T extends { created_at: string }> = Omit<T, "created_at">;
export type DemandClusterInsert = Insert<DemandClusterRow>;
export type DemandClusterMembershipInsert = Insert<DemandClusterMembershipRow>;
export type DemandClusterStateInsert = Insert<DemandClusterStateRow>;

/** Read-only projection of the qualified evidence chain for one evaluation. */
export type DemandClusteringEvidence = {
  evaluation: { id: string; workspace_id: string; product_id: string; product_match_id: string; conversation_id: string; evidence_node_id: string; decision: string; evidence: Json; created_at: string };
  currentEvaluationId: string | null;
  signal: { id: string; lifecycle_status: string; evidence_node_id: string } | null;
  conversation: { id: string; evidence_node_id: string; published_at: string | null; last_activity_at: string | null } | null;
  sourceItem: { id: string; evidence_node_id: string; source_key: string; content_hash: string | null; published_at: string | null } | null;
};

/** Upper bound of state-history rows read in one batched latest-state lookup. */
export const DEMAND_CLUSTER_STATE_READ_LIMIT = 5000;

export type DemandClusterLatestStates = {
  /** Latest state per cluster (highest sequence), ordered by cluster id. */
  states: DemandClusterStateRow[];
  historyLength: Record<string, number>;
  /** True when the bounded read hit its limit; missing clusters must be treated as unknown, never as current. */
  truncated: boolean;
};

export type DemandClusterStateContribution = { stateEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; reason: string | null };

/** Live lifecycle of one product match, read at request time. */
export type DemandClusterMatchLifecycle = { productMatchId: string; found: boolean; currentEvaluationId: string | null; signalLifecycleStatus: string | null };

export type DemandClusterBuyerLanguage = { matchEvaluationId: string; phrase: string; normalizedValue: string };

/** Reduces a batch of state rows to the latest state per cluster (highest sequence). */
export function reduceLatestStates(rows: DemandClusterStateRow[], limit: number): DemandClusterLatestStates {
  const latest = new Map<string, DemandClusterStateRow>();
  const historyLength: Record<string, number> = {};
  for (const row of rows) {
    historyLength[row.cluster_id] = (historyLength[row.cluster_id] ?? 0) + 1;
    const current = latest.get(row.cluster_id);
    if (!current || row.sequence > current.sequence) latest.set(row.cluster_id, row);
  }
  return { states: [...latest.values()].sort((left, right) => left.cluster_id.localeCompare(right.cluster_id)), historyLength, truncated: rows.length >= limit };
}

export type DemandClusteringProvenanceEdge = {
  derivedEvidenceNodeId: string;
  sourceEvidenceNodeId: string;
  relationType: string;
  weight?: number;
  ordinal?: number;
  measurement?: Json | null;
  engineVersionId?: string | null;
};

export interface DemandClusteringRepository {
  /** Qualified evaluations for the product, newest first, bounded. */
  listQualifiedEvidence(workspaceId: string, productId: string, limit: number): Promise<DemandClusteringEvidence[]>;
  /** Same projection for explicit evaluation IDs (any decision), product-scoped. */
  loadEvidence(workspaceId: string, productId: string, evaluationIds: string[]): Promise<DemandClusteringEvidence[]>;
  listClusters(workspaceId: string, productId: string, clusteringVersion: string): Promise<DemandClusterRow[]>;
  /** Idempotent: an existing row with the same natural key is returned unchanged. */
  createCluster(input: DemandClusterInsert): Promise<DemandClusterRow>;
  listMemberships(workspaceId: string, productId: string, clusteringVersion: string): Promise<DemandClusterMembershipRow[]>;
  /** Idempotent: an existing row with the same natural key is returned unchanged. */
  createMembership(input: DemandClusterMembershipInsert): Promise<DemandClusterMembershipRow>;
  latestState(workspaceId: string, productId: string, clusterId: string, strengthVersion: string): Promise<DemandClusterStateRow | null>;
  listStates(workspaceId: string, productId: string, clusterId: string, strengthVersion: string): Promise<DemandClusterStateRow[]>;
  /** Returns null when (cluster, version, sequence) already exists (lost a race or replay). */
  createState(input: DemandClusterStateInsert): Promise<DemandClusterStateRow | null>;
  linkProvenance(edge: DemandClusteringProvenanceEdge): Promise<void>;
  /** A state's `strengthened_by` / `excluded_membership` edges (membership evidence nodes). */
  listStateContributions(stateEvidenceNodeId: string): Promise<Array<{ sourceEvidenceNodeId: string; relationType: string; reason: string | null }>>;
  /** Latest state of every cluster of the product in one bounded read (no per-cluster queries). */
  listLatestStates(workspaceId: string, productId: string, strengthVersion: string): Promise<DemandClusterLatestStates>;
  /** Contribution edges of many states, in chunked batch reads. */
  listStateContributionsForStates(stateEvidenceNodeIds: string[]): Promise<DemandClusterStateContribution[]>;
  /** Current evaluation and signal lifecycle for product matches, product-scoped, chunked. */
  loadMatchLifecycle(workspaceId: string, productId: string, productMatchIds: string[]): Promise<DemandClusterMatchLifecycle[]>;
  /** Buyer-language observations for the given evaluations, product-scoped, chunked. */
  listBuyerLanguage(workspaceId: string, productId: string, evaluationIds: string[]): Promise<DemandClusterBuyerLanguage[]>;
}

const CONTRIBUTION_RELATIONS = ["strengthened_by", "excluded_membership"];

function reasonOf(measurement: unknown): string | null {
  if (!measurement || typeof measurement !== "object" || Array.isArray(measurement)) return null;
  const reason = (measurement as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type Result<T> = PromiseLike<{ data: T; error: ErrorResult }>;
type Filterable = Result<Row[] | null> & {
  eq(field: string, value: unknown): Filterable;
  in(field: string, values: unknown[]): Filterable;
  order(field: string, options: { ascending: boolean }): Filterable;
  limit(count: number): Filterable;
  maybeSingle(): Result<Row | null>;
};
type Query = {
  select(columns: string): Filterable;
  insert(row: Row): { select(columns: string): { single(): Result<Row | null> } };
  upsert(row: Row, options: { onConflict: string; ignoreDuplicates: boolean }): Result<null>;
};
type Client = { from(table: string): Query };

const CHUNK = 100;

function persistenceError(error: ErrorResult, context: string): Error {
  const code = error?.code ? ` (${error.code})` : "";
  const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
  return new Error(`Demand clustering persistence failed during ${context}${code}${message}`);
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK) result.push(values.slice(index, index + CHUNK));
  return result;
}

export class SupabaseDemandClusteringRepository implements DemandClusteringRepository {
  constructor(private readonly client: unknown) {}

  private table(name: string): Query {
    return (this.client as Client).from(name);
  }

  private async rows(query: Filterable, context: string): Promise<Row[]> {
    const { data, error } = await query;
    if (error) throw persistenceError(error, context);
    return data ?? [];
  }

  private async byIds(table: string, columns: string, ids: string[], scope: { workspaceId?: string; productId?: string }, context: string, field = "id"): Promise<Row[]> {
    const result: Row[] = [];
    for (const part of chunks([...new Set(ids)])) {
      let query = this.table(table).select(columns).in(field, part);
      if (scope.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
      if (scope.productId) query = query.eq("product_id", scope.productId);
      result.push(...await this.rows(query, context));
    }
    return result;
  }

  private async project(workspaceId: string, productId: string, evaluations: Row[]): Promise<DemandClusteringEvidence[]> {
    const matchIds = evaluations.map((row) => String(row.product_match_id));
    const matches = await this.byIds("product_matches", "id, current_match_evaluation_id", matchIds, { workspaceId, productId }, "match lookup");
    const signals = await this.byIds("signals", "id, product_match_id, lifecycle_status, evidence_node_id", matchIds, { workspaceId, productId }, "signal lookup", "product_match_id");
    const conversations = await this.byIds("conversations", "id, evidence_node_id, primary_source_item_id, published_at, last_activity_at", evaluations.map((row) => String(row.conversation_id)), {}, "conversation lookup");
    const sources = await this.byIds("source_items", "id, evidence_node_id, source_key, content_hash, published_at", conversations.map((row) => String(row.primary_source_item_id)), {}, "source item lookup");
    const matchById = new Map(matches.map((row) => [String(row.id), row]));
    const signalByMatch = new Map(signals.map((row) => [String(row.product_match_id), row]));
    const conversationById = new Map(conversations.map((row) => [String(row.id), row]));
    const sourceById = new Map(sources.map((row) => [String(row.id), row]));
    return evaluations.map((row) => {
      const match = matchById.get(String(row.product_match_id));
      const signal = signalByMatch.get(String(row.product_match_id));
      const conversation = conversationById.get(String(row.conversation_id));
      const source = conversation ? sourceById.get(String(conversation.primary_source_item_id)) : undefined;
      return {
        evaluation: row as DemandClusteringEvidence["evaluation"],
        currentEvaluationId: match ? (match.current_match_evaluation_id as string | null) : null,
        signal: signal ? signal as NonNullable<DemandClusteringEvidence["signal"]> : null,
        conversation: conversation ? conversation as NonNullable<DemandClusteringEvidence["conversation"]> : null,
        sourceItem: source ? source as NonNullable<DemandClusteringEvidence["sourceItem"]> : null,
      };
    });
  }

  private static readonly EVALUATION_COLUMNS = "id, workspace_id, product_id, product_match_id, conversation_id, evidence_node_id, decision, evidence, created_at";

  async listQualifiedEvidence(workspaceId: string, productId: string, limit: number) {
    const evaluations = await this.rows(this.table("product_match_evaluations").select(SupabaseDemandClusteringRepository.EVALUATION_COLUMNS).eq("workspace_id", workspaceId).eq("product_id", productId).eq("decision", "qualified").order("created_at", { ascending: false }).limit(limit), "qualified evaluation lookup");
    return this.project(workspaceId, productId, evaluations);
  }

  async loadEvidence(workspaceId: string, productId: string, evaluationIds: string[]) {
    if (!evaluationIds.length) return [];
    const evaluations = await this.byIds("product_match_evaluations", SupabaseDemandClusteringRepository.EVALUATION_COLUMNS, evaluationIds, { workspaceId, productId }, "evaluation lookup");
    return this.project(workspaceId, productId, evaluations);
  }

  private async evidenceNode(id: string, nodeType: string, workspaceId: string, entityTable: string, entityId: string) {
    const { error } = await this.table("evidence_nodes").upsert({ id, node_type: nodeType, workspace_id: workspaceId, entity_table: entityTable, entity_id: entityId }, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw persistenceError(error, `${nodeType} evidence anchor`);
  }

  async listClusters(workspaceId: string, productId: string, clusteringVersion: string) {
    return await this.rows(this.table("demand_clusters").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).order("cluster_key", { ascending: true }), "cluster lookup") as DemandClusterRow[];
  }

  async createCluster(input: DemandClusterInsert) {
    await this.evidenceNode(input.evidence_node_id, "demand_cluster", input.workspace_id, "demand_clusters", input.id);
    const { data, error } = await this.table("demand_clusters").insert(input as unknown as Row).select("*").single();
    if (!error && data) return data as DemandClusterRow;
    if (error?.code !== "23505") throw persistenceError(error, "cluster insert");
    const existing = (await this.listClusters(input.workspace_id, input.product_id, input.clustering_version)).find((row) => row.cluster_key === input.cluster_key);
    if (!existing) throw persistenceError(error, "cluster conflict resolution");
    return existing;
  }

  async listMemberships(workspaceId: string, productId: string, clusteringVersion: string) {
    return await this.rows(this.table("demand_cluster_memberships").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("clustering_version", clusteringVersion).order("created_at", { ascending: true }), "membership lookup") as DemandClusterMembershipRow[];
  }

  async createMembership(input: DemandClusterMembershipInsert) {
    await this.evidenceNode(input.evidence_node_id, "demand_cluster_membership", input.workspace_id, "demand_cluster_memberships", input.id);
    const { data, error } = await this.table("demand_cluster_memberships").insert(input as unknown as Row).select("*").single();
    if (!error && data) return data as DemandClusterMembershipRow;
    if (error?.code !== "23505") throw persistenceError(error, "membership insert");
    const existing = (await this.listMemberships(input.workspace_id, input.product_id, input.clustering_version)).find((row) => row.match_evaluation_id === input.match_evaluation_id);
    if (!existing) throw persistenceError(error, "membership conflict resolution");
    return existing;
  }

  async listStates(workspaceId: string, productId: string, clusterId: string, strengthVersion: string) {
    return await this.rows(this.table("demand_cluster_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("cluster_id", clusterId).eq("strength_version", strengthVersion).order("sequence", { ascending: true }), "state history lookup") as DemandClusterStateRow[];
  }

  async latestState(workspaceId: string, productId: string, clusterId: string, strengthVersion: string) {
    const rows = await this.rows(this.table("demand_cluster_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("cluster_id", clusterId).eq("strength_version", strengthVersion).order("sequence", { ascending: false }).limit(1), "latest state lookup");
    return (rows[0] as DemandClusterStateRow | undefined) ?? null;
  }

  async createState(input: DemandClusterStateInsert) {
    await this.evidenceNode(input.evidence_node_id, "demand_cluster_state", input.workspace_id, "demand_cluster_states", input.id);
    const { data, error } = await this.table("demand_cluster_states").insert(input as unknown as Row).select("*").single();
    if (!error && data) return data as DemandClusterStateRow;
    if (error?.code === "23505") return null;
    throw persistenceError(error, "state insert");
  }

  async linkProvenance(edge: DemandClusteringProvenanceEdge) {
    const { error } = await this.table("evidence_provenance").upsert({ derived_evidence_node_id: edge.derivedEvidenceNodeId, source_evidence_node_id: edge.sourceEvidenceNodeId, relation_type: edge.relationType, weight: edge.weight ?? null, ordinal: edge.ordinal ?? null, span: null, measurement: edge.measurement ?? null, engine_version_id: edge.engineVersionId ?? null }, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true });
    if (error) throw persistenceError(error, "provenance link");
  }

  async listStateContributions(stateEvidenceNodeId: string) {
    const rows = await this.rows(this.table("evidence_provenance").select("source_evidence_node_id, relation_type, measurement").eq("derived_evidence_node_id", stateEvidenceNodeId).in("relation_type", CONTRIBUTION_RELATIONS), "state contribution lookup");
    return rows.map((row) => ({ sourceEvidenceNodeId: String(row.source_evidence_node_id), relationType: String(row.relation_type), reason: reasonOf(row.measurement) }));
  }

  async listLatestStates(workspaceId: string, productId: string, strengthVersion: string) {
    const rows = await this.rows(this.table("demand_cluster_states").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("strength_version", strengthVersion).order("created_at", { ascending: false }).limit(DEMAND_CLUSTER_STATE_READ_LIMIT), "latest state batch lookup") as DemandClusterStateRow[];
    return reduceLatestStates(rows, DEMAND_CLUSTER_STATE_READ_LIMIT);
  }

  async listStateContributionsForStates(stateEvidenceNodeIds: string[]) {
    const result: DemandClusterStateContribution[] = [];
    for (const part of chunks([...new Set(stateEvidenceNodeIds)])) {
      const rows = await this.rows(this.table("evidence_provenance").select("derived_evidence_node_id, source_evidence_node_id, relation_type, measurement").in("derived_evidence_node_id", part).in("relation_type", CONTRIBUTION_RELATIONS), "state contribution batch lookup");
      result.push(...rows.map((row) => ({ stateEvidenceNodeId: String(row.derived_evidence_node_id), sourceEvidenceNodeId: String(row.source_evidence_node_id), relationType: String(row.relation_type), reason: reasonOf(row.measurement) })));
    }
    return result;
  }

  async loadMatchLifecycle(workspaceId: string, productId: string, productMatchIds: string[]) {
    const ids = [...new Set(productMatchIds)];
    if (!ids.length) return [];
    const matches = await this.byIds("product_matches", "id, current_match_evaluation_id", ids, { workspaceId, productId }, "match lifecycle lookup");
    const signals = await this.byIds("signals", "id, product_match_id, lifecycle_status", ids, { workspaceId, productId }, "signal lifecycle lookup", "product_match_id");
    const matchById = new Map(matches.map((row) => [String(row.id), row]));
    const signalByMatch = new Map(signals.map((row) => [String(row.product_match_id), row]));
    return ids.map((id) => {
      const match = matchById.get(id);
      const signal = signalByMatch.get(id);
      return { productMatchId: id, found: Boolean(match), currentEvaluationId: match ? (match.current_match_evaluation_id as string | null) : null, signalLifecycleStatus: signal ? String(signal.lifecycle_status) : null };
    });
  }

  async listBuyerLanguage(workspaceId: string, productId: string, evaluationIds: string[]) {
    if (!evaluationIds.length) return [];
    const rows = await this.byIds("demand_observations", "match_evaluation_id, observation_type, facet_value, normalized_value", evaluationIds, { workspaceId, productId }, "buyer language lookup", "match_evaluation_id");
    return rows.filter((row) => row.observation_type === "buyer_language").map((row) => ({ matchEvaluationId: String(row.match_evaluation_id), phrase: String(row.facet_value), normalizedValue: String(row.normalized_value) }));
  }
}

/**
 * In-memory implementation that mirrors the migration's natural keys and
 * composite-FK product scoping, for tests and fixtures.
 */
export class InMemoryDemandClusteringRepository implements DemandClusteringRepository {
  readonly evidence = new Map<string, DemandClusteringEvidence>();
  readonly clusters = new Map<string, DemandClusterRow>();
  readonly memberships = new Map<string, DemandClusterMembershipRow>();
  readonly states = new Map<string, DemandClusterStateRow>();
  readonly provenance: DemandClusteringProvenanceEdge[] = [];
  readonly buyerLanguage: Array<DemandClusterBuyerLanguage & { workspaceId: string; productId: string }> = [];
  /** Read-call counters, so tests can assert batched (non N+1) access. */
  readonly calls: Record<string, number> = {};
  private clock = 0;

  private count(method: string) {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
  }

  private stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 8, 1) + this.clock).toISOString();
  }

  async listQualifiedEvidence(workspaceId: string, productId: string, limit: number) {
    return [...this.evidence.values()]
      .filter((item) => item.evaluation.workspace_id === workspaceId && item.evaluation.product_id === productId && item.evaluation.decision === "qualified")
      .sort((left, right) => right.evaluation.created_at.localeCompare(left.evaluation.created_at))
      .slice(0, limit);
  }

  async loadEvidence(workspaceId: string, productId: string, evaluationIds: string[]) {
    const wanted = new Set(evaluationIds);
    return [...this.evidence.values()].filter((item) => wanted.has(item.evaluation.id) && item.evaluation.workspace_id === workspaceId && item.evaluation.product_id === productId);
  }

  async listClusters(workspaceId: string, productId: string, clusteringVersion: string) {
    return [...this.clusters.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion).sort((left, right) => left.cluster_key.localeCompare(right.cluster_key));
  }

  async createCluster(input: DemandClusterInsert) {
    const existing = [...this.clusters.values()].find((row) => row.workspace_id === input.workspace_id && row.product_id === input.product_id && row.clustering_version === input.clustering_version && row.cluster_key === input.cluster_key);
    if (existing) return existing;
    const row = { ...input, created_at: this.stamp() };
    this.clusters.set(row.id, row);
    return row;
  }

  async listMemberships(workspaceId: string, productId: string, clusteringVersion: string) {
    return [...this.memberships.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.clustering_version === clusteringVersion);
  }

  async createMembership(input: DemandClusterMembershipInsert) {
    const cluster = this.clusters.get(input.cluster_id);
    // Mirrors FK (workspace_id, product_id, cluster_id) -> demand_clusters.
    if (!cluster || cluster.workspace_id !== input.workspace_id || cluster.product_id !== input.product_id) throw new Error("foreign key violation: demand_cluster_memberships -> demand_clusters (workspace_id, product_id, id)");
    const existing = [...this.memberships.values()].find((row) => row.workspace_id === input.workspace_id && row.product_id === input.product_id && row.clustering_version === input.clustering_version && row.match_evaluation_id === input.match_evaluation_id);
    if (existing) return existing;
    const row = { ...input, created_at: this.stamp() };
    this.memberships.set(row.id, row);
    return row;
  }

  private statesFor(workspaceId: string, productId: string, clusterId: string, strengthVersion: string) {
    return [...this.states.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.cluster_id === clusterId && row.strength_version === strengthVersion).sort((left, right) => left.sequence - right.sequence);
  }

  async listStates(workspaceId: string, productId: string, clusterId: string, strengthVersion: string) {
    this.count("listStates");
    return this.statesFor(workspaceId, productId, clusterId, strengthVersion);
  }

  async latestState(workspaceId: string, productId: string, clusterId: string, strengthVersion: string) {
    this.count("latestState");
    return this.statesFor(workspaceId, productId, clusterId, strengthVersion).at(-1) ?? null;
  }

  async createState(input: DemandClusterStateInsert) {
    const cluster = this.clusters.get(input.cluster_id);
    if (!cluster || cluster.workspace_id !== input.workspace_id || cluster.product_id !== input.product_id) throw new Error("foreign key violation: demand_cluster_states -> demand_clusters (workspace_id, product_id, id)");
    if ([...this.states.values()].some((row) => row.workspace_id === input.workspace_id && row.cluster_id === input.cluster_id && row.strength_version === input.strength_version && row.sequence === input.sequence)) return null;
    const row = { ...input, created_at: this.stamp() };
    this.states.set(row.id, row);
    return row;
  }

  async linkProvenance(edge: DemandClusteringProvenanceEdge) {
    if (!this.provenance.some((item) => item.derivedEvidenceNodeId === edge.derivedEvidenceNodeId && item.sourceEvidenceNodeId === edge.sourceEvidenceNodeId && item.relationType === edge.relationType && item.ordinal === edge.ordinal)) this.provenance.push(edge);
  }

  async listStateContributions(stateEvidenceNodeId: string) {
    this.count("listStateContributions");
    return this.provenance.filter((edge) => edge.derivedEvidenceNodeId === stateEvidenceNodeId && CONTRIBUTION_RELATIONS.includes(edge.relationType)).map((edge) => ({ sourceEvidenceNodeId: edge.sourceEvidenceNodeId, relationType: edge.relationType, reason: reasonOf(edge.measurement) }));
  }

  async listLatestStates(workspaceId: string, productId: string, strengthVersion: string) {
    this.count("listLatestStates");
    const rows = [...this.states.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.strength_version === strengthVersion);
    return reduceLatestStates(rows, Number.POSITIVE_INFINITY);
  }

  async listStateContributionsForStates(stateEvidenceNodeIds: string[]) {
    this.count("listStateContributionsForStates");
    const wanted = new Set(stateEvidenceNodeIds);
    return this.provenance.filter((edge) => wanted.has(edge.derivedEvidenceNodeId) && CONTRIBUTION_RELATIONS.includes(edge.relationType)).map((edge) => ({ stateEvidenceNodeId: edge.derivedEvidenceNodeId, sourceEvidenceNodeId: edge.sourceEvidenceNodeId, relationType: edge.relationType, reason: reasonOf(edge.measurement) }));
  }

  async loadMatchLifecycle(workspaceId: string, productId: string, productMatchIds: string[]) {
    this.count("loadMatchLifecycle");
    const scoped = [...this.evidence.values()].filter((item) => item.evaluation.workspace_id === workspaceId && item.evaluation.product_id === productId);
    return [...new Set(productMatchIds)].map((id) => {
      const item = scoped.filter((candidate) => candidate.evaluation.product_match_id === id).at(-1);
      return { productMatchId: id, found: Boolean(item), currentEvaluationId: item?.currentEvaluationId ?? null, signalLifecycleStatus: item?.signal?.lifecycle_status ?? null };
    });
  }

  async listBuyerLanguage(workspaceId: string, productId: string, evaluationIds: string[]) {
    this.count("listBuyerLanguage");
    const wanted = new Set(evaluationIds);
    return this.buyerLanguage.filter((row) => row.workspaceId === workspaceId && row.productId === productId && wanted.has(row.matchEvaluationId)).map(({ matchEvaluationId, phrase, normalizedValue }) => ({ matchEvaluationId, phrase, normalizedValue }));
  }
}
