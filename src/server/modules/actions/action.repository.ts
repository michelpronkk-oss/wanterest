import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ActionEventInsert, ActionEventRow, ActionFeedbackInsert, ActionFeedbackRow, ActionInsert, ActionRow,
  ActionUpdate, ActionVariantInsert, ActionVariantRow, DigestInsert, DigestItemInsert, DigestItemRow, DigestRow,
  Json, JsonObject, UsageLedgerRow,
} from "../../db/database.helpers";
import type {
  Database,
} from "../../db/database.types";
import { AppError } from "../../lib/errors";
import type { ActionListFilters } from "./action.schemas";
import { OPEN_ACTION_STATUSES, CONCEPT_ACTION_TRIGGER_TYPES } from "./action.schemas";
import type { ProductRow, ProductSnapshotRow } from "../../db/database.helpers";

/** Layer 10 DB-side bound on open concept Actions per product (at most one per concept, <= 500 concepts). */
export const OPEN_CONCEPT_ACTION_LIMIT = 500;

/** Basis guard shape consumed by the SQL `assert_concept_action_basis_guard` (see concept-action.selector.ts). */
export type ActionBasisGuardPayload = {
  marketStatePolicyVersion: string;
  marketStateId: string;
  gapStatePolicyVersion: string;
  gapStateId: string | null;
  driftStatePolicyVersion: string;
  driftStateIds: Record<string, string | null>;
};

/** Input to the atomic `create_concept_action` RPC. Replay identity is (workspace_id, idempotency_key). */
export type CreateConceptActionRequest = {
  action: ActionInsert & { id: string; trigger_clustering_version: string; proposal_fingerprint: string };
  supersedeActionId?: string | null;
  expectedStatus?: string | null;
  basisGuard?: ActionBasisGuardPayload | null;
  provenanceWeight?: number;
  eventMetadata?: JsonObject;
  traceId?: string;
};

/** Input to the compare-and-set `transition_action` RPC. */
export type AtomicActionTransition = {
  workspaceId: string;
  actionId: string;
  from: string;
  to: string;
  actorKind: "user" | "system" | "service";
  actorUserId?: string | null;
  metadata?: JsonObject;
  basisGuard?: ActionBasisGuardPayload | null;
  traceId?: string;
};

export type ActionClient = SupabaseClient<Database>;

export type ActionRepository = {
  createAction(input: ActionInsert): Promise<ActionRow>;
  getAction(workspaceId: string, actionId: string): Promise<ActionRow | null>;
  findActionByIdempotency(workspaceId: string, idempotencyKey: string): Promise<ActionRow | null>;
  listActions(workspaceId: string, productId: string, filters?: ActionListFilters): Promise<ActionRow[]>;
  updateAction(workspaceId: string, actionId: string, patch: ActionUpdate): Promise<ActionRow>;
  createVariant(input: ActionVariantInsert): Promise<ActionVariantRow>;
  findVariant(workspaceId: string, actionId: string, variantKey: string, inputFingerprint: string): Promise<ActionVariantRow | null>;
  listVariants(workspaceId: string, actionId: string): Promise<ActionVariantRow[]>;
  createFeedback(input: ActionFeedbackInsert): Promise<ActionFeedbackRow>;
  listFeedback(workspaceId: string, actionId: string): Promise<ActionFeedbackRow[]>;
  createEvent(input: ActionEventInsert): Promise<ActionEventRow>;
  listEvents(workspaceId: string, actionId: string): Promise<ActionEventRow[]>;
  createDigest(input: DigestInsert): Promise<DigestRow>;
  findDigest(workspaceId: string, idempotencyKey: string): Promise<DigestRow | null>;
  getDigest(workspaceId: string, digestId: string): Promise<DigestRow | null>;
  listDigests(workspaceId: string, productId?: string | null): Promise<DigestRow[]>;
  markDigestSent(workspaceId: string, digestId: string, sentAt: string): Promise<DigestRow>;
  createDigestItem(input: DigestItemInsert): Promise<DigestItemRow>;
  listDigestItems(workspaceId: string, digestId: string): Promise<DigestItemRow[]>;
  linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }): Promise<void>;
  consumeUsage(input: { workspaceId: string; idempotencyKey: string; sourceMetadata: JsonObject; traceId?: string }): Promise<UsageLedgerRow | null>;
  /** Layer 10: atomic concept Action creation/supersession (service-role RPC). */
  createConceptAction(input: CreateConceptActionRequest): Promise<ActionRow>;
  /** Layer 10: compare-and-set transition + event (+ audit for users) in one transaction (service-role RPC). */
  transitionActionAtomic(input: AtomicActionTransition): Promise<ActionRow>;
  /** Layer 10: open concept Actions for one product, DB-side bounded. */
  listOpenConceptActions(workspaceId: string, productId: string): Promise<ActionRow[]>;
  /** Layer 10: the most recently closed concept Action for one canonical concept (limit 1). */
  latestClosedConceptAction(workspaceId: string, productId: string, clusteringVersion: string, conceptKey: string): Promise<ActionRow | null>;
  /** Layer 10: latest event of one type for one Action (limit 1). */
  latestEvent(workspaceId: string, actionId: string, eventType: string): Promise<ActionEventRow | null>;
  /** Layer 10: current positioning snapshot (`current_snapshot_id`, else latest version) — one row. */
  getPositioningSnapshot(product: Pick<ProductRow, "workspace_id" | "id" | "current_snapshot_id">): Promise<ProductSnapshotRow | null>;
};

/** Maps the Layer 10 RPC exceptions to stable application errors. */
export function actionRpcError(error: { code?: string; message: string } | null, fallback: string): AppError {
  const message = error?.message ?? "";
  for (const reason of ["action_basis_changed", "action_status_conflict", "action_replay_conflict", "action_transition_invalid"] as const) {
    if (message.includes(reason)) return new AppError("CONFLICT", fallback, 409, { reason });
  }
  if (message.includes("action_not_found")) return new AppError("NOT_FOUND", "Action was not found.");
  if (message.includes("action_actor_forbidden") || message.includes("action_transition_system_only")) return new AppError("FORBIDDEN", "You cannot change this Action.");
  if (error?.code === "23505") return new AppError("CONFLICT", fallback, 409, { reason: "open_concept_action_exists" });
  return dbError(error, fallback);
}

function dbError(error: { code?: string; message: string } | null, message: string): AppError {
  if (error?.code === "23505") return new AppError("CONFLICT", message);
  if (error?.code === "42501") return new AppError("FORBIDDEN", "You cannot use this workspace.");
  if (error?.code === "P0001" || error?.message.includes("usage_capability_disabled")) return new AppError("CAPABILITY_DISABLED", "This workspace capability is not enabled.");
  if (error?.code === "22003" || error?.message.includes("usage_limit_exceeded")) return new AppError("USAGE_LIMIT_EXCEEDED", "The workspace action limit was reached.");
  return new AppError("INTERNAL_ERROR", message, 500, error ? { providerMessage: error.message } : undefined);
}

async function insert<T>(result: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>, message: string): Promise<T> {
  const { data, error } = await result;
  if (error || !data) throw dbError(error, message);
  return data;
}

export class SupabaseActionRepository implements ActionRepository {
  constructor(private readonly client: ActionClient) {}

  private async evidence(id: string, nodeType: string, workspaceId: string, entityTable: string, entityId: string) {
    const { error } = await this.client.from("evidence_nodes").upsert({ id, node_type: nodeType, workspace_id: workspaceId, entity_table: entityTable, entity_id: entityId }, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw dbError(error, "Action evidence anchor could not be stored.");
  }

  async createAction(input: ActionInsert) {
    const id = input.id ?? crypto.randomUUID();
    const existing = await this.findActionByIdempotency(String(input.workspace_id), String(input.idempotency_key));
    if (existing) return existing;
    await this.evidence(String(input.evidence_node_id), "action", String(input.workspace_id), "actions", id);
    try {
      return await insert(this.client.from("actions").insert({ ...input, id }).select("*").single().overrideTypes<ActionRow>(), "Action could not be stored.");
    } catch (error) {
      if (error instanceof AppError && error.code === "CONFLICT") {
        const retry = await this.findActionByIdempotency(String(input.workspace_id), String(input.idempotency_key));
        if (retry) return retry;
      }
      throw error;
    }
  }
  async getAction(workspaceId: string, actionId: string) { const { data, error } = await this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("id", actionId).maybeSingle(); if (error) throw dbError(error, "Action could not be loaded."); return data; }
  async findActionByIdempotency(workspaceId: string, idempotencyKey: string) { const { data, error } = await this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle(); if (error) throw dbError(error, "Action could not be loaded."); return data; }
  async listActions(workspaceId: string, productId: string, filters: ActionListFilters = {}) { let q = this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (filters.status) q = q.eq("status", filters.status); if (filters.actionType) q = q.eq("action_type", filters.actionType); if (filters.triggerType) q = q.eq("trigger_type", filters.triggerType); if (filters.minimumPriority !== undefined) q = q.gte("priority_score", filters.minimumPriority); if (filters.from) q = q.gte("created_at", filters.from); if (filters.to) q = q.lt("created_at", filters.to); if (filters.limit) q = q.limit(filters.limit); const { data, error } = await q.order("priority_score", { ascending: false }).order("created_at", { ascending: false }); if (error) throw dbError(error, "Actions could not be loaded."); return (data ?? []).filter((row) => filters.stale === undefined || (filters.stale ? row.stale_at !== null : row.stale_at === null)); }
  async updateAction(workspaceId: string, actionId: string, patch: ActionUpdate) { return insert(this.client.from("actions").update(patch).eq("workspace_id", workspaceId).eq("id", actionId).select("*").single().overrideTypes<ActionRow>(), "Action could not be updated."); }
  async createVariant(input: ActionVariantInsert) { const id = input.id ?? crypto.randomUUID(); const existing = await this.findVariant(String(input.workspace_id), String(input.action_id), String(input.variant_key), String(input.input_fingerprint)); if (existing) return existing; await this.evidence(String(input.evidence_node_id), "action_variant", String(input.workspace_id), "action_variants", id); try { return await insert(this.client.from("action_variants").insert({ ...input, id }).select("*").single().overrideTypes<ActionVariantRow>(), "Action variant could not be stored."); } catch (error) { if (error instanceof AppError && error.code === "CONFLICT") { const retry = await this.findVariant(String(input.workspace_id), String(input.action_id), String(input.variant_key), String(input.input_fingerprint)); if (retry) return retry; } throw error; } }
  async findVariant(workspaceId: string, actionId: string, variantKey: string, inputFingerprint: string) { const { data, error } = await this.client.from("action_variants").select("*").eq("workspace_id", workspaceId).eq("action_id", actionId).eq("variant_key", variantKey).eq("input_fingerprint", inputFingerprint).maybeSingle(); if (error) throw dbError(error, "Action variant could not be loaded."); return data; }
  async listVariants(workspaceId: string, actionId: string) { const { data, error } = await this.client.from("action_variants").select("*").eq("workspace_id", workspaceId).eq("action_id", actionId).order("created_at", { ascending: true }); if (error) throw dbError(error, "Action variants could not be loaded."); return data ?? []; }
  async createFeedback(input: ActionFeedbackInsert) { return insert(this.client.from("action_feedback").insert({ ...input, id: input.id ?? crypto.randomUUID() }).select("*").single().overrideTypes<ActionFeedbackRow>(), "Action feedback could not be stored."); }
  async listFeedback(workspaceId: string, actionId: string) { const { data, error } = await this.client.from("action_feedback").select("*").eq("workspace_id", workspaceId).eq("action_id", actionId).order("created_at", { ascending: true }); if (error) throw dbError(error, "Action feedback could not be loaded."); return data ?? []; }
  async createEvent(input: ActionEventInsert) { return insert(this.client.from("action_events").insert({ ...input, id: input.id ?? crypto.randomUUID() }).select("*").single().overrideTypes<ActionEventRow>(), "Action event could not be stored."); }
  async listEvents(workspaceId: string, actionId: string) { const { data, error } = await this.client.from("action_events").select("*").eq("workspace_id", workspaceId).eq("action_id", actionId).order("created_at", { ascending: true }); if (error) throw dbError(error, "Action events could not be loaded."); return data ?? []; }
  async createDigest(input: DigestInsert) { const id = input.id ?? crypto.randomUUID(); const existing = await this.findDigest(String(input.workspace_id), String(input.idempotency_key)); if (existing) return existing; await this.evidence(String(input.evidence_node_id), "digest", String(input.workspace_id), "digests", id); try { return await insert(this.client.from("digests").insert({ ...input, id }).select("*").single().overrideTypes<DigestRow>(), "Digest could not be stored."); } catch (error) { if (error instanceof AppError && error.code === "CONFLICT") { const retry = await this.findDigest(String(input.workspace_id), String(input.idempotency_key)); if (retry) return retry; } throw error; } }
  async findDigest(workspaceId: string, idempotencyKey: string) { const { data, error } = await this.client.from("digests").select("*").eq("workspace_id", workspaceId).eq("idempotency_key", idempotencyKey).maybeSingle(); if (error) throw dbError(error, "Digest could not be loaded."); return data; }
  async getDigest(workspaceId: string, digestId: string) { const { data, error } = await this.client.from("digests").select("*").eq("workspace_id", workspaceId).eq("id", digestId).maybeSingle(); if (error) throw dbError(error, "Digest could not be loaded."); return data; }
  async listDigests(workspaceId: string, productId?: string | null) { let q = this.client.from("digests").select("*").eq("workspace_id", workspaceId); if (productId === null) q = q.is("product_id", null); else if (productId) q = q.eq("product_id", productId); const { data, error } = await q.order("period_end", { ascending: false }); if (error) throw dbError(error, "Digests could not be loaded."); return data ?? []; }
  async markDigestSent(workspaceId: string, digestId: string, sentAt: string) { return insert(this.client.from("digests").update({ status: "sent", sent_at: sentAt }).eq("workspace_id", workspaceId).eq("id", digestId).select("*").single().overrideTypes<DigestRow>(), "Digest could not be marked sent."); }
  async createDigestItem(input: DigestItemInsert) { return insert(this.client.from("digest_items").insert({ ...input, id: input.id ?? crypto.randomUUID() }).select("*").single().overrideTypes<DigestItemRow>(), "Digest item could not be stored."); }
  async listDigestItems(workspaceId: string, digestId: string) { const { data, error } = await this.client.from("digest_items").select("*").eq("workspace_id", workspaceId).eq("digest_id", digestId).order("position", { ascending: true }); if (error) throw dbError(error, "Digest items could not be loaded."); return data ?? []; }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }) { const { error } = await this.client.from("evidence_provenance").upsert({ derived_evidence_node_id: input.derivedEvidenceNodeId, source_evidence_node_id: input.sourceEvidenceNodeId, relation_type: input.relationType, weight: input.weight, ordinal: input.ordinal, span: input.span ?? null, measurement: input.measurement ?? null, engine_version_id: input.engineVersionId ?? null }, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true }); if (error) throw dbError(error, "Action provenance could not be stored."); }
  async consumeUsage(input: { workspaceId: string; idempotencyKey: string; sourceMetadata: JsonObject; traceId?: string }) { const args: Database["public"]["Functions"]["consume_usage"]["Args"] = { p_workspace_id: input.workspaceId, p_usage_type: "action_generated", p_amount: 1, p_idempotency_key: input.idempotencyKey, p_source_metadata: input.sourceMetadata }; if (input.traceId !== undefined) args.p_trace_id = input.traceId; const { data, error } = await this.client.rpc("consume_usage", args); if (error) throw dbError(error, "Action usage could not be recorded."); return data; }
  async createConceptAction(input: CreateConceptActionRequest) {
    const args: Database["public"]["Functions"]["create_concept_action"]["Args"] = {
      p_action: input.action as unknown as Json,
      p_provenance_weight: input.provenanceWeight ?? 1,
      p_event_metadata: (input.eventMetadata ?? {}) as Json,
    };
    if (input.supersedeActionId) args.p_supersede_action_id = input.supersedeActionId;
    if (input.expectedStatus) args.p_expected_status = input.expectedStatus;
    if (input.basisGuard) args.p_basis_guard = input.basisGuard as unknown as Json;
    if (input.traceId !== undefined) args.p_trace_id = input.traceId;
    const { data, error } = await this.client.rpc("create_concept_action", args);
    if (error || !data) throw actionRpcError(error, "Concept Action could not be stored.");
    return data as unknown as ActionRow;
  }
  async transitionActionAtomic(input: AtomicActionTransition) {
    const args: Database["public"]["Functions"]["transition_action"]["Args"] = {
      p_workspace_id: input.workspaceId, p_action_id: input.actionId, p_from: input.from, p_to: input.to,
      p_actor_kind: input.actorKind, p_metadata: (input.metadata ?? {}) as Json,
    };
    if (input.actorUserId) args.p_actor_user_id = input.actorUserId;
    if (input.basisGuard) args.p_basis_guard = input.basisGuard as unknown as Json;
    if (input.traceId !== undefined) args.p_trace_id = input.traceId;
    const { data, error } = await this.client.rpc("transition_action", args);
    if (error || !data) throw actionRpcError(error, "Action could not be updated.");
    return data as unknown as ActionRow;
  }
  async listOpenConceptActions(workspaceId: string, productId: string) { const { data, error } = await this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).in("trigger_type", [...CONCEPT_ACTION_TRIGGER_TYPES]).in("status", [...OPEN_ACTION_STATUSES]).order("created_at", { ascending: true }).limit(OPEN_CONCEPT_ACTION_LIMIT); if (error) throw dbError(error, "Open Actions could not be loaded."); return data ?? []; }
  async latestClosedConceptAction(workspaceId: string, productId: string, clusteringVersion: string, conceptKey: string) { const { data, error } = await this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).eq("trigger_clustering_version", clusteringVersion).eq("trigger_concept_key", conceptKey).in("trigger_type", [...CONCEPT_ACTION_TRIGGER_TYPES]).in("status", ["completed", "dismissed", "superseded", "expired"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(); if (error) throw dbError(error, "Closed Action could not be loaded."); return data; }
  async latestEvent(workspaceId: string, actionId: string, eventType: string) { const { data, error } = await this.client.from("action_events").select("*").eq("workspace_id", workspaceId).eq("action_id", actionId).eq("event_type", eventType).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (error) throw dbError(error, "Action event could not be loaded."); return data; }
  async getPositioningSnapshot(product: Pick<ProductRow, "workspace_id" | "id" | "current_snapshot_id">) {
    if (product.current_snapshot_id) {
      const { data, error } = await this.client.from("product_snapshots").select("*").eq("workspace_id", product.workspace_id).eq("product_id", product.id).eq("id", product.current_snapshot_id).limit(1).maybeSingle();
      if (error) throw dbError(error, "Positioning snapshot could not be loaded.");
      if (data) return data;
    }
    const { data, error } = await this.client.from("product_snapshots").select("*").eq("workspace_id", product.workspace_id).eq("product_id", product.id).order("snapshot_version", { ascending: false }).limit(1).maybeSingle();
    if (error) throw dbError(error, "Positioning snapshot could not be loaded.");
    return data;
  }
}

function now(): string { return new Date().toISOString(); }
function withDefaults<T extends { id: string; workspace_id: string; created_at: string }>(input: Partial<T>): T { return { ...input, id: input.id ?? crypto.randomUUID(), workspace_id: input.workspace_id ?? "", created_at: input.created_at ?? now() } as T; }

export class InMemoryActionRepository implements ActionRepository {
  readonly actions = new Map<string, ActionRow>();
  readonly variants = new Map<string, ActionVariantRow>();
  readonly feedback = new Map<string, ActionFeedbackRow>();
  readonly events = new Map<string, ActionEventRow>();
  readonly digests = new Map<string, DigestRow>();
  readonly digestItems = new Map<string, DigestItemRow>();
  readonly provenance: Array<{ derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }> = [];
  readonly consumedUsage = new Set<string>();
  /** Layer 10 emulation state (mirrors the migration's RPC semantics for deterministic tests). */
  readonly evidenceNodes = new Set<string>();
  readonly auditRows: Array<{ workspaceId: string; actorUserId: string; action: string; targetId: string; metadata: JsonObject }> = [];
  readonly members = new Map<string, "owner" | "admin" | "member" | "viewer">();
  readonly snapshots = new Map<string, ProductSnapshotRow>();
  usageRefusal: "CAPABILITY_DISABLED" | "USAGE_LIMIT_EXCEEDED" | null = null;
  /** Wire to the concept-state repository to emulate `assert_concept_action_basis_guard`; throws `action_basis_changed`. */
  basisGuardCheck: ((identity: { workspaceId: string; productId: string; clusteringVersion: string; anchorConceptKey: string }, guard: ActionBasisGuardPayload) => Promise<void>) | null = null;
  private eventClock = 0;

  private conflict(reason: string): AppError { return new AppError("CONFLICT", "Action write conflict.", 409, { reason }); }

  private pushEvent(row: ActionRow, input: { actorUserId: string | null; actorKind: string; eventType: string; from: string | null; to: string | null; metadata: JsonObject }) {
    this.eventClock += 1;
    const event = { id: crypto.randomUUID(), workspace_id: row.workspace_id, product_id: row.product_id, action_id: row.id, actor_user_id: input.actorUserId, actor_kind: input.actorKind, event_type: input.eventType, from_status: input.from, to_status: input.to, metadata: input.metadata, created_at: new Date(Date.UTC(2026, 8, 20) + this.eventClock).toISOString() } as ActionEventRow;
    this.events.set(event.id, event);
  }

  private isOpenConcept(row: ActionRow) { return (row.trigger_type === "concept_gap" || row.trigger_type === "concept_drift") && (row.status === "proposed" || row.status === "approved" || row.status === "in_progress"); }

  async createConceptAction(input: CreateConceptActionRequest) {
    const payload = input.action;
    const snapshot = { actions: new Map([...this.actions].map(([key, value]) => [key, { ...value }])), events: new Map(this.events), provenance: [...this.provenance], nodes: new Set(this.evidenceNodes), usage: new Set(this.consumedUsage) };
    const rollback = () => { this.actions.clear(); snapshot.actions.forEach((value, key) => this.actions.set(key, value)); this.events.clear(); snapshot.events.forEach((value, key) => this.events.set(key, value)); this.provenance.splice(0, this.provenance.length, ...snapshot.provenance); this.evidenceNodes.clear(); snapshot.nodes.forEach((value) => this.evidenceNodes.add(value)); this.consumedUsage.clear(); snapshot.usage.forEach((value) => this.consumedUsage.add(value)); };
    try {
      const old = input.supersedeActionId ? this.actions.get(input.supersedeActionId) : undefined;
      if (input.supersedeActionId && (!old || old.workspace_id !== payload.workspace_id)) throw new AppError("NOT_FOUND", "Action was not found.");
      const existing = await this.findActionByIdempotency(String(payload.workspace_id), String(payload.idempotency_key));
      if (existing) {
        if (!old || old.id === existing.id) return existing;
        if (old.status === "superseded" && old.superseded_by_action_id === existing.id) return existing;
        if (old.status === input.expectedStatus && (old.status === "proposed" || old.status === "approved")) {
          const from = old.status;
          this.actions.set(old.id, { ...old, status: "superseded", stale_at: old.stale_at ?? new Date().toISOString(), superseded_by_action_id: existing.id });
          this.pushEvent(old, { actorUserId: null, actorKind: "system", eventType: "superseded", from, to: "superseded", metadata: { ...(input.eventMetadata ?? {}), supersededByActionId: existing.id } });
          return existing;
        }
        throw this.conflict("action_replay_conflict");
      }
      if (input.basisGuard && this.basisGuardCheck) await this.basisGuardCheck({ workspaceId: String(payload.workspace_id), productId: String(payload.product_id), clusteringVersion: payload.trigger_clustering_version, anchorConceptKey: String(payload.trigger_concept_key) }, input.basisGuard);
      if (old) {
        if (!input.expectedStatus || old.status !== input.expectedStatus || !(old.status === "proposed" || old.status === "approved")) throw this.conflict("action_status_conflict");
        this.actions.set(old.id, { ...old, status: "superseded", stale_at: old.stale_at ?? new Date().toISOString() });
      }
      // actions_one_open_concept_action
      const clash = [...this.actions.values()].find((row) => this.isOpenConcept(row) && row.workspace_id === payload.workspace_id && row.product_id === payload.product_id && row.trigger_clustering_version === payload.trigger_clustering_version && row.trigger_concept_key === payload.trigger_concept_key);
      if (clash) throw new AppError("CONFLICT", "Action write conflict.", 409, { reason: "open_concept_action_exists" });
      this.evidenceNodes.add(String(payload.evidence_node_id));
      const created = withDefaults<ActionRow>({ ...payload, status: "proposed", approved_at: null, completed_at: null, dismissed_at: null, stale_at: null, superseded_by_action_id: null, valid_from: new Date().toISOString(), updated_at: new Date().toISOString() } as Partial<ActionRow>);
      this.actions.set(created.id, created);
      await this.linkProvenance({ derivedEvidenceNodeId: created.evidence_node_id, sourceEvidenceNodeId: created.trigger_evidence_node_id, relationType: "triggered_by", weight: input.provenanceWeight ?? 1, ordinal: 0, engineVersionId: created.action_engine_version_id });
      if (old) {
        const from = old.status;
        this.actions.set(old.id, { ...this.actions.get(old.id)!, superseded_by_action_id: created.id });
        this.pushEvent(old, { actorUserId: null, actorKind: "system", eventType: "superseded", from, to: "superseded", metadata: { ...(input.eventMetadata ?? {}), supersededByActionId: created.id } });
        this.pushEvent(created, { actorUserId: null, actorKind: "system", eventType: "regenerated", from: null, to: "proposed", metadata: { ...(input.eventMetadata ?? {}), supersedesActionId: old.id } });
        await this.linkProvenance({ derivedEvidenceNodeId: created.evidence_node_id, sourceEvidenceNodeId: old.evidence_node_id, relationType: "supersedes_action", weight: 1, ordinal: 0, engineVersionId: created.action_engine_version_id });
      }
      if (this.usageRefusal) throw new AppError(this.usageRefusal, "Action usage refused.");
      this.consumedUsage.add(`${created.workspace_id}:action_generated:${created.id}`);
      return created;
    } catch (error) {
      rollback();
      throw error;
    }
  }

  async transitionActionAtomic(input: AtomicActionTransition) {
    const row = this.actions.get(input.actionId);
    if (!row || row.workspace_id !== input.workspaceId) throw new AppError("NOT_FOUND", "Action was not found.");
    if (row.status !== input.from) throw this.conflict("action_status_conflict");
    const concept = row.trigger_type === "concept_gap" || row.trigger_type === "concept_drift";
    const allowed = (input.from === "proposed" && (["approved", "dismissed", "expired"].includes(input.to) || (input.to === "superseded" && !concept)))
      || (input.from === "approved" && (["in_progress", "dismissed", "expired"].includes(input.to) || (input.to === "superseded" && !concept)))
      || (input.from === "in_progress" && ["completed", "dismissed"].includes(input.to));
    if (!allowed) throw this.conflict("action_transition_invalid");
    if (input.to === "expired" && input.actorKind !== "system") throw new AppError("FORBIDDEN", "You cannot change this Action.");
    if (input.actorKind === "user") {
      const role = input.actorUserId ? this.members.get(`${input.workspaceId}:${input.actorUserId}`) : undefined;
      if (!role || role === "viewer") throw new AppError("FORBIDDEN", "You cannot change this Action.");
    }
    if (concept && (input.to === "approved" || input.to === "in_progress")) {
      if (!input.basisGuard) throw new AppError("VALIDATION_ERROR", "action_basis_guard_required");
      if (this.basisGuardCheck) await this.basisGuardCheck({ workspaceId: row.workspace_id, productId: row.product_id, clusteringVersion: String(row.trigger_clustering_version), anchorConceptKey: row.trigger_concept_key }, input.basisGuard);
    }
    const current = this.actions.get(input.actionId)!;
    if (current.status !== input.from) throw this.conflict("action_status_conflict");
    const stamp = new Date().toISOString();
    const updated = { ...current, status: input.to, approved_at: input.to === "approved" ? stamp : current.approved_at, completed_at: input.to === "completed" ? stamp : current.completed_at, dismissed_at: input.to === "dismissed" ? stamp : current.dismissed_at, stale_at: input.to === "expired" || input.to === "superseded" ? current.stale_at ?? stamp : current.stale_at, updated_at: stamp } as ActionRow;
    this.actions.set(updated.id, updated);
    const eventType = input.to === "in_progress" ? "started" : input.to;
    this.pushEvent(updated, { actorUserId: input.actorUserId ?? null, actorKind: input.actorKind, eventType, from: input.from, to: input.to, metadata: input.metadata ?? {} });
    if (input.actorKind === "user" && input.actorUserId) this.auditRows.push({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: `action.${input.to}`, targetId: updated.id, metadata: input.metadata ?? {} });
    return updated;
  }

  async listOpenConceptActions(workspaceId: string, productId: string) { return [...this.actions.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && this.isOpenConcept(row)).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, OPEN_CONCEPT_ACTION_LIMIT); }
  async latestClosedConceptAction(workspaceId: string, productId: string, clusteringVersion: string, conceptKey: string) { return [...this.actions.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && row.trigger_clustering_version === clusteringVersion && row.trigger_concept_key === conceptKey && (row.trigger_type === "concept_gap" || row.trigger_type === "concept_drift") && ["completed", "dismissed", "superseded", "expired"].includes(row.status)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null; }
  async latestEvent(workspaceId: string, actionId: string, eventType: string) { return [...this.events.values()].filter((row) => row.workspace_id === workspaceId && row.action_id === actionId && row.event_type === eventType).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null; }
  async getPositioningSnapshot(product: Pick<ProductRow, "workspace_id" | "id" | "current_snapshot_id">) { const rows = [...this.snapshots.values()].filter((row) => row.workspace_id === product.workspace_id && row.product_id === product.id).sort((a, b) => a.snapshot_version - b.snapshot_version); return rows.find((row) => row.id === product.current_snapshot_id) ?? rows.at(-1) ?? null; }

  async createAction(input: ActionInsert) { const existing = [...this.actions.values()].find((row) => row.workspace_id === input.workspace_id && row.idempotency_key === input.idempotency_key); if (existing) return existing; const row = withDefaults<ActionRow>(input); this.actions.set(row.id, row); return row; }
  async getAction(workspaceId: string, actionId: string) { const row = this.actions.get(actionId); return row?.workspace_id === workspaceId ? row : null; }
  async findActionByIdempotency(workspaceId: string, idempotencyKey: string) { return [...this.actions.values()].find((row) => row.workspace_id === workspaceId && row.idempotency_key === idempotencyKey) ?? null; }
  async listActions(workspaceId: string, productId: string, filters: ActionListFilters = {}) { const rows = [...this.actions.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && (filters.status === undefined || row.status === filters.status) && (filters.actionType === undefined || row.action_type === filters.actionType) && (filters.triggerType === undefined || row.trigger_type === filters.triggerType) && (filters.minimumPriority === undefined || row.priority_score >= filters.minimumPriority) && (filters.stale === undefined || (filters.stale ? row.stale_at !== null : row.stale_at === null)) && (filters.from === undefined || row.created_at >= filters.from) && (filters.to === undefined || row.created_at < filters.to)).sort((a, b) => b.priority_score - a.priority_score || b.created_at.localeCompare(a.created_at)); return filters.limit ? rows.slice(0, filters.limit) : rows; }
  async updateAction(workspaceId: string, actionId: string, patch: ActionUpdate) { const row = await this.getAction(workspaceId, actionId); if (!row) throw new AppError("NOT_FOUND", "Action was not found."); const updated = { ...row, ...patch, updated_at: now() } as ActionRow; this.actions.set(actionId, updated); return updated; }
  async createVariant(input: ActionVariantInsert) { const existing = [...this.variants.values()].find((row) => row.workspace_id === input.workspace_id && row.action_id === input.action_id && row.variant_key === input.variant_key && row.input_fingerprint === input.input_fingerprint); if (existing) return existing; const row = withDefaults<ActionVariantRow>(input); this.variants.set(row.id, row); return row; }
  async findVariant(workspaceId: string, actionId: string, variantKey: string, inputFingerprint: string) { return [...this.variants.values()].find((row) => row.workspace_id === workspaceId && row.action_id === actionId && row.variant_key === variantKey && row.input_fingerprint === inputFingerprint) ?? null; }
  async listVariants(workspaceId: string, actionId: string) { return [...this.variants.values()].filter((row) => row.workspace_id === workspaceId && row.action_id === actionId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async createFeedback(input: ActionFeedbackInsert) { const row = withDefaults<ActionFeedbackRow>(input); this.feedback.set(row.id, row); return row; }
  async listFeedback(workspaceId: string, actionId: string) { return [...this.feedback.values()].filter((row) => row.workspace_id === workspaceId && row.action_id === actionId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async createEvent(input: ActionEventInsert) { const row = withDefaults<ActionEventRow>(input); this.events.set(row.id, row); return row; }
  async listEvents(workspaceId: string, actionId: string) { return [...this.events.values()].filter((row) => row.workspace_id === workspaceId && row.action_id === actionId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async createDigest(input: DigestInsert) { const existing = [...this.digests.values()].find((row) => row.workspace_id === input.workspace_id && row.idempotency_key === input.idempotency_key); if (existing) return existing; const row = withDefaults<DigestRow>(input); this.digests.set(row.id, row); return row; }
  async findDigest(workspaceId: string, idempotencyKey: string) { return [...this.digests.values()].find((row) => row.workspace_id === workspaceId && row.idempotency_key === idempotencyKey) ?? null; }
  async getDigest(workspaceId: string, digestId: string) { const row = this.digests.get(digestId); return row?.workspace_id === workspaceId ? row : null; }
  async listDigests(workspaceId: string, productId?: string | null) { return [...this.digests.values()].filter((row) => row.workspace_id === workspaceId && (productId === undefined || row.product_id === productId)).sort((a, b) => b.period_end.localeCompare(a.period_end)); }
  async markDigestSent(workspaceId: string, digestId: string, sentAt: string) { const row = await this.getDigest(workspaceId, digestId); if (!row) throw new AppError("NOT_FOUND", "Digest was not found."); const updated = { ...row, status: "sent", sent_at: sentAt } as DigestRow; this.digests.set(row.id, updated); return updated; }
  async createDigestItem(input: DigestItemInsert) { const existing = [...this.digestItems.values()].find((row) => row.digest_id === input.digest_id && row.item_type === input.item_type && row.item_id === input.item_id); if (existing) return existing; const row = withDefaults<DigestItemRow>(input); this.digestItems.set(row.id, row); return row; }
  async listDigestItems(workspaceId: string, digestId: string) { return [...this.digestItems.values()].filter((row) => row.workspace_id === workspaceId && row.digest_id === digestId).sort((a, b) => a.position - b.position); }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; weight?: number; ordinal?: number; span?: Json | null; measurement?: Json | null; engineVersionId?: string | null }) { if (!this.provenance.some((edge) => edge.derivedEvidenceNodeId === input.derivedEvidenceNodeId && edge.sourceEvidenceNodeId === input.sourceEvidenceNodeId && edge.relationType === input.relationType && edge.ordinal === input.ordinal)) this.provenance.push(input); }
  async consumeUsage(input: { workspaceId: string; idempotencyKey: string; sourceMetadata: JsonObject }) { const key = `${input.workspaceId}:${input.idempotencyKey}`; if (this.consumedUsage.has(key)) return null; this.consumedUsage.add(key); return null; }
}
