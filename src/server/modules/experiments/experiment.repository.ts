import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

import type {
  ExperimentAssignmentInsert, ExperimentAssignmentRow, ExperimentEventInsert, ExperimentEventRow,
  ExperimentInsert, ExperimentPublicTokenInsert, ExperimentPublicTokenRow, ExperimentResultInsert,
  ExperimentResultRow, ExperimentRow, ExperimentUpdate, ExperimentVariantInsert, ExperimentVariantRow,
} from "../../db/database.helpers";
import type { Database } from "../../db/database.types";
import { AppError } from "../../lib/errors";

export type ExperimentClient = SupabaseClient<Database>;

export type ExperimentRepository = {
  createExperiment(input: ExperimentInsert): Promise<ExperimentRow>;
  getExperiment(workspaceId: string, experimentId: string): Promise<ExperimentRow | null>;
  listExperiments(workspaceId: string, productId?: string): Promise<ExperimentRow[]>;
  updateExperiment(workspaceId: string, experimentId: string, patch: ExperimentUpdate): Promise<ExperimentRow>;
  deleteExperiment(workspaceId: string, experimentId: string): Promise<void>;
  createVariant(input: ExperimentVariantInsert): Promise<ExperimentVariantRow>;
  listVariants(workspaceId: string, experimentId: string): Promise<ExperimentVariantRow[]>;
  createAssignment(input: ExperimentAssignmentInsert): Promise<ExperimentAssignmentRow>;
  getAssignment(workspaceId: string, experimentId: string, subjectKeyHash: string): Promise<ExperimentAssignmentRow | null>;
  getAssignmentById(workspaceId: string, experimentId: string, assignmentId: string): Promise<ExperimentAssignmentRow | null>;
  listAssignments(workspaceId: string, experimentId: string): Promise<ExperimentAssignmentRow[]>;
  recordEvent(input: ExperimentEventInsert): Promise<ExperimentEventRow>;
  listEvents(workspaceId: string, experimentId: string): Promise<ExperimentEventRow[]>;
  createResult(input: ExperimentResultInsert): Promise<ExperimentResultRow>;
  latestResult(workspaceId: string, experimentId: string): Promise<ExperimentResultRow | null>;
  issueToken(input: ExperimentPublicTokenInsert): Promise<ExperimentPublicTokenRow>;
  findTokenByHash(tokenHash: string): Promise<ExperimentPublicTokenRow | null>;
  updateToken(id: string, patch: Partial<ExperimentPublicTokenRow>): Promise<ExperimentPublicTokenRow>;
  linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; ordinal?: number; weight?: number }): Promise<void>;
};

function repositoryError(message: string, error?: { code?: string; message?: string }): AppError {
  if (error?.code === "23505") return new AppError("CONFLICT", message);
  if (error?.code === "42501") return new AppError("FORBIDDEN", "You cannot use this workspace.");
  return new AppError("INTERNAL_ERROR", message, 500, error?.message ? { providerMessage: error.message } : undefined);
}

async function single<T>(result: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>, message: string): Promise<T> {
  const { data, error } = await result;
  if (error || !data) throw repositoryError(message, error ?? undefined);
  return data;
}

export class SupabaseExperimentRepository implements ExperimentRepository {
  constructor(private readonly client: ExperimentClient) {}

  private async evidence(id: string, nodeType: string, workspaceId: string, entityTable: string, entityId: string) {
    const { error } = await this.client.from("evidence_nodes").upsert({ id, node_type: nodeType, workspace_id: workspaceId, entity_table: entityTable, entity_id: entityId }, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw repositoryError("Experiment evidence could not be stored.", error);
  }

  async createExperiment(input: ExperimentInsert) {
    const id = input.id ?? randomUUID();
    await this.evidence(String(input.evidence_node_id), "experiment", String(input.workspace_id), "experiments", id);
    return single<ExperimentRow>(this.client.from("experiments").insert({ ...input, id }).select("*").single(), "Experiment could not be stored.");
  }
  async getExperiment(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.from("experiments").select("*").eq("workspace_id", workspaceId).eq("id", experimentId).maybeSingle();
    if (error) throw repositoryError("Experiment could not be loaded.", error);
    return data;
  }
  async listExperiments(workspaceId: string, productId?: string) {
    let query = this.client.from("experiments").select("*").eq("workspace_id", workspaceId);
    if (productId) query = query.eq("product_id", productId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw repositoryError("Experiments could not be loaded.", error);
    return data ?? [];
  }
  async updateExperiment(workspaceId: string, experimentId: string, patch: ExperimentUpdate) {
    return single<ExperimentRow>(this.client.from("experiments").update(patch).eq("workspace_id", workspaceId).eq("id", experimentId).select("*").single(), "Experiment could not be updated.");
  }
  async deleteExperiment(workspaceId: string, experimentId: string) {
    const { error } = await this.client.from("experiments").delete().eq("workspace_id", workspaceId).eq("id", experimentId);
    if (error) throw repositoryError("Experiment could not be rolled back.", error);
  }
  async createVariant(input: ExperimentVariantInsert) {
    const id = input.id ?? randomUUID();
    await this.evidence(String(input.evidence_node_id), "experiment_variant", String(input.workspace_id), "experiment_variants", id);
    return single<ExperimentVariantRow>(this.client.from("experiment_variants").insert({ ...input, id }).select("*").single(), "Experiment variant could not be stored.");
  }
  async listVariants(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.from("experiment_variants").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).order("created_at", { ascending: true });
    if (error) throw repositoryError("Experiment variants could not be loaded.", error);
    return data ?? [];
  }
  async createAssignment(input: ExperimentAssignmentInsert) {
    const existing = await this.getAssignment(input.workspace_id, input.experiment_id, input.subject_key_hash);
    if (existing) return existing;
    return single<ExperimentAssignmentRow>(this.client.from("experiment_assignments").insert(input).select("*").single(), "Experiment assignment could not be stored.");
  }
  async getAssignment(workspaceId: string, experimentId: string, subjectKeyHash: string) {
    const { data, error } = await this.client.from("experiment_assignments").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).eq("subject_key_hash", subjectKeyHash).maybeSingle();
    if (error) throw repositoryError("Experiment assignment could not be loaded.", error);
    return data;
  }
  async getAssignmentById(workspaceId: string, experimentId: string, assignmentId: string) { const { data, error } = await this.client.from("experiment_assignments").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).eq("id", assignmentId).maybeSingle(); if (error) throw repositoryError("Experiment assignment could not be loaded.", error); return data; }
  async listAssignments(workspaceId: string, experimentId: string) { const { data, error } = await this.client.from("experiment_assignments").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).order("assigned_at", { ascending: true }); if (error) throw repositoryError("Experiment assignments could not be loaded.", error); return data ?? []; }
  async recordEvent(input: ExperimentEventInsert) {
    const { data: existing } = await this.client.from("experiment_events").select("*").eq("experiment_id", input.experiment_id).eq("external_event_id", input.external_event_id).maybeSingle();
    if (existing) return existing;
    return single<ExperimentEventRow>(this.client.from("experiment_events").insert(input).select("*").single(), "Experiment event could not be stored.");
  }
  async listEvents(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.from("experiment_events").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).order("occurred_at", { ascending: true });
    if (error) throw repositoryError("Experiment events could not be loaded.", error);
    return data ?? [];
  }
  async createResult(input: ExperimentResultInsert) {
    const id = input.id ?? randomUUID();
    await this.evidence(String(input.evidence_node_id), "experiment_result", String(input.workspace_id), "experiment_results", id);
    return single<ExperimentResultRow>(this.client.from("experiment_results").insert({ ...input, id }).select("*").single(), "Experiment result could not be stored.");
  }
  async latestResult(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.from("experiment_results").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).order("revision", { ascending: false }).limit(1).maybeSingle();
    if (error) throw repositoryError("Experiment result could not be loaded.", error);
    return data;
  }
  async issueToken(input: ExperimentPublicTokenInsert) {
    return single<ExperimentPublicTokenRow>(this.client.from("experiment_public_tokens").insert(input).select("*").single(), "Experiment public token could not be stored.");
  }
  async findTokenByHash(tokenHash: string) {
    const { data, error } = await this.client.from("experiment_public_tokens").select("*").eq("token_hash", tokenHash).eq("status", "active").maybeSingle();
    if (error) throw repositoryError("Experiment public token could not be loaded.", error);
    return data;
  }
  async updateToken(id: string, patch: Partial<ExperimentPublicTokenRow>) {
    return single<ExperimentPublicTokenRow>(this.client.from("experiment_public_tokens").update(patch).eq("id", id).select("*").single(), "Experiment public token could not be updated.");
  }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; ordinal?: number; weight?: number }) {
    const { error } = await this.client.from("evidence_provenance").upsert({ derived_evidence_node_id: input.derivedEvidenceNodeId, source_evidence_node_id: input.sourceEvidenceNodeId, relation_type: input.relationType, ordinal: input.ordinal ?? 0, weight: input.weight ?? null }, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true });
    if (error) throw repositoryError("Experiment provenance could not be stored.", error);
  }
}

export function hashExperimentSubject(experimentId: string, subjectKey: string): string {
  return createHash("sha256").update(`${experimentId}:${subjectKey}`).digest("hex");
}

export class InMemoryExperimentRepository implements ExperimentRepository {
  readonly experiments = new Map<string, ExperimentRow>();
  readonly variants = new Map<string, ExperimentVariantRow>();
  readonly assignments = new Map<string, ExperimentAssignmentRow>();
  readonly events = new Map<string, ExperimentEventRow>();
  readonly results = new Map<string, ExperimentResultRow>();
  readonly tokens = new Map<string, ExperimentPublicTokenRow>();
  readonly provenance: Array<{ derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; ordinal?: number; weight?: number }> = [];

  async createExperiment(input: ExperimentInsert) { const createdAt = input.created_at ?? new Date().toISOString(); const row = { ...input, id: input.id ?? randomUUID(), created_at: createdAt, updated_at: input.updated_at ?? createdAt } as ExperimentRow; this.experiments.set(row.id, row); return row; }
  async getExperiment(workspaceId: string, experimentId: string) { const row = this.experiments.get(experimentId); return row?.workspace_id === workspaceId ? row : null; }
  async listExperiments(workspaceId: string, productId?: string) { return [...this.experiments.values()].filter((row) => row.workspace_id === workspaceId && (!productId || row.product_id === productId)).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async updateExperiment(workspaceId: string, experimentId: string, patch: ExperimentUpdate) { const row = await this.getExperiment(workspaceId, experimentId); if (!row) throw new AppError("NOT_FOUND", "Experiment was not found."); const updated = { ...row, ...patch, updated_at: new Date().toISOString() }; this.experiments.set(row.id, updated); return updated; }
  async deleteExperiment(workspaceId: string, experimentId: string) { const row = await this.getExperiment(workspaceId, experimentId); if (row) this.experiments.delete(row.id); }
  async createVariant(input: ExperimentVariantInsert) { const row = { ...input, id: input.id ?? randomUUID(), created_at: input.created_at ?? new Date().toISOString() } as ExperimentVariantRow; this.variants.set(row.id, row); return row; }
  async listVariants(workspaceId: string, experimentId: string) { return [...this.variants.values()].filter((row) => row.workspace_id === workspaceId && row.experiment_id === experimentId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async createAssignment(input: ExperimentAssignmentInsert) { const existing = await this.getAssignment(input.workspace_id, input.experiment_id, input.subject_key_hash); if (existing) return existing; const row = { ...input, id: input.id ?? randomUUID(), assigned_at: input.assigned_at ?? new Date().toISOString() } as ExperimentAssignmentRow; this.assignments.set(row.id, row); return row; }
  async getAssignment(workspaceId: string, experimentId: string, subjectKeyHash: string) { return [...this.assignments.values()].find((row) => row.workspace_id === workspaceId && row.experiment_id === experimentId && row.subject_key_hash === subjectKeyHash) ?? null; }
  async getAssignmentById(workspaceId: string, experimentId: string, assignmentId: string) { const row = this.assignments.get(assignmentId); return row?.workspace_id === workspaceId && row.experiment_id === experimentId ? row : null; }
  async listAssignments(workspaceId: string, experimentId: string) { return [...this.assignments.values()].filter((row) => row.workspace_id === workspaceId && row.experiment_id === experimentId).sort((a, b) => a.assigned_at.localeCompare(b.assigned_at)); }
  async recordEvent(input: ExperimentEventInsert) { const existing = [...this.events.values()].find((row) => row.experiment_id === input.experiment_id && row.external_event_id === input.external_event_id); if (existing) return existing; const createdAt = input.created_at ?? new Date().toISOString(); const row = { ...input, id: input.id ?? randomUUID(), received_at: input.received_at ?? createdAt, created_at: createdAt } as ExperimentEventRow; this.events.set(row.id, row); return row; }
  async listEvents(workspaceId: string, experimentId: string) { return [...this.events.values()].filter((row) => row.workspace_id === workspaceId && row.experiment_id === experimentId).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)); }
  async createResult(input: ExperimentResultInsert) { const createdAt = input.created_at ?? new Date().toISOString(); const row = { ...input, id: input.id ?? randomUUID(), calculated_at: input.calculated_at ?? createdAt, created_at: createdAt } as ExperimentResultRow; this.results.set(row.id, row); return row; }
  async latestResult(workspaceId: string, experimentId: string) { return [...this.results.values()].filter((row) => row.workspace_id === workspaceId && row.experiment_id === experimentId).sort((a, b) => b.revision - a.revision)[0] ?? null; }
  async issueToken(input: ExperimentPublicTokenInsert) { const row = { ...input, id: input.id ?? randomUUID(), created_at: input.created_at ?? new Date().toISOString() } as ExperimentPublicTokenRow; this.tokens.set(row.id, row); return row; }
  async findTokenByHash(tokenHash: string) { return [...this.tokens.values()].find((row) => row.token_hash === tokenHash && row.status === "active") ?? null; }
  async updateToken(id: string, patch: Partial<ExperimentPublicTokenRow>) { const row = this.tokens.get(id); if (!row) throw new AppError("NOT_FOUND", "Experiment token was not found."); const updated = { ...row, ...patch }; this.tokens.set(id, updated); return updated; }
  async linkProvenance(input: { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; ordinal?: number; weight?: number }) { this.provenance.push(input); }
}
