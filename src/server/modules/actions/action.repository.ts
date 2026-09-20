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
};

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
  async listActions(workspaceId: string, productId: string, filters: ActionListFilters = {}) { let q = this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("product_id", productId); if (filters.status) q = q.eq("status", filters.status); if (filters.actionType) q = q.eq("action_type", filters.actionType); if (filters.triggerType) q = q.eq("trigger_type", filters.triggerType); if (filters.minimumPriority !== undefined) q = q.gte("priority_score", filters.minimumPriority); if (filters.from) q = q.gte("created_at", filters.from); if (filters.to) q = q.lt("created_at", filters.to); const { data, error } = await q.order("priority_score", { ascending: false }).order("created_at", { ascending: false }); if (error) throw dbError(error, "Actions could not be loaded."); return (data ?? []).filter((row) => filters.stale === undefined || (filters.stale ? row.stale_at !== null : row.stale_at === null)); }
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

  async createAction(input: ActionInsert) { const existing = [...this.actions.values()].find((row) => row.workspace_id === input.workspace_id && row.idempotency_key === input.idempotency_key); if (existing) return existing; const row = withDefaults<ActionRow>(input); this.actions.set(row.id, row); return row; }
  async getAction(workspaceId: string, actionId: string) { const row = this.actions.get(actionId); return row?.workspace_id === workspaceId ? row : null; }
  async findActionByIdempotency(workspaceId: string, idempotencyKey: string) { return [...this.actions.values()].find((row) => row.workspace_id === workspaceId && row.idempotency_key === idempotencyKey) ?? null; }
  async listActions(workspaceId: string, productId: string, filters: ActionListFilters = {}) { return [...this.actions.values()].filter((row) => row.workspace_id === workspaceId && row.product_id === productId && (filters.status === undefined || row.status === filters.status) && (filters.actionType === undefined || row.action_type === filters.actionType) && (filters.triggerType === undefined || row.trigger_type === filters.triggerType) && (filters.minimumPriority === undefined || row.priority_score >= filters.minimumPriority) && (filters.stale === undefined || (filters.stale ? row.stale_at !== null : row.stale_at === null)) && (filters.from === undefined || row.created_at >= filters.from) && (filters.to === undefined || row.created_at < filters.to)).sort((a, b) => b.priority_score - a.priority_score || b.created_at.localeCompare(a.created_at)); }
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
