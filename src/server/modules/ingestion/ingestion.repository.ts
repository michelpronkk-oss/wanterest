import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ConversationInsert,
  ConversationRow,
  ConversationSourceItemInsert,
  EvidenceNodeInsert,
  EvidenceProvenanceInsert,
  EvidenceProvenanceRow,
  JobRunInsert,
  JobRunRow,
  JobRunUpdate,
  RawSourceItemInsert,
  RawSourceItemRow,
  SourceHealthInsert,
  SourceHealthRow,
  SourceItemInsert,
  SourceItemRow,
} from "../../db/database.helpers";
import type { Database } from "../../db/database.types";

export type IngestionClient = SupabaseClient<Database>;

export type RawSourceItemFilter = {
  sourceKey?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export interface IngestionRepository {
  getJobRun(jobType: string, idempotencyKey: string): Promise<JobRunRow | null>;
  createJobRun(input: JobRunInsert): Promise<JobRunRow>;
  updateJobRun(id: string, input: JobRunUpdate): Promise<JobRunRow>;

  insertRawSourceItem(input: RawSourceItemInsert, evidence: EvidenceNodeInsert): Promise<RawSourceItemRow>;
  getRawSourceItem(id: string): Promise<RawSourceItemRow | null>;
  listRawSourceItems(filter: RawSourceItemFilter): Promise<RawSourceItemRow[]>;

  upsertSourceItem(input: SourceItemInsert, evidence: EvidenceNodeInsert): Promise<SourceItemRow>;
  getSourceItem(id: string): Promise<SourceItemRow | null>;

  findConversationByKey(conversationKey: string): Promise<ConversationRow | null>;
  findConversationByContentHash(contentHash: string): Promise<ConversationRow | null>;
  upsertConversation(input: ConversationInsert, evidence: EvidenceNodeInsert): Promise<ConversationRow>;
  clearConversationPrimary(conversationId: string): Promise<void>;
  upsertConversationSourceItem(input: ConversationSourceItemInsert): Promise<void>;
  insertEvidenceProvenance(input: EvidenceProvenanceInsert): Promise<EvidenceProvenanceRow>;

  upsertSourceHealth(input: SourceHealthInsert): Promise<SourceHealthRow>;
  getSourceHealth(sourceKey: string, environment: string): Promise<SourceHealthRow | null>;
}

function databaseFailure(message: string, error: { message: string }): Error {
  return new Error(`${message}: ${error.message}`);
}

export class SupabaseIngestionRepository implements IngestionRepository {
  constructor(private readonly client: IngestionClient) {}

  async getJobRun(jobType: string, idempotencyKey: string): Promise<JobRunRow | null> {
    const { data, error } = await this.client
      .from("job_runs")
      .select("*")
      .eq("job_type", jobType)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw databaseFailure("Job run could not be loaded", error);
    return data;
  }

  async createJobRun(input: JobRunInsert): Promise<JobRunRow> {
    const { data, error } = await this.client
      .from("job_runs")
      .upsert(input, { onConflict: "job_type,idempotency_key", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw databaseFailure("Job run could not be created", error);
    if (data) return data;
    const existing = await this.getJobRun(input.job_type, input.idempotency_key);
    if (!existing) throw new Error("Job run was not returned after idempotent insert.");
    return existing;
  }

  async updateJobRun(id: string, input: JobRunUpdate): Promise<JobRunRow> {
    const { data, error } = await this.client.from("job_runs").update(input).eq("id", id).select("*").single();
    if (error || !data) throw databaseFailure("Job run could not be updated", error ?? { message: "No row returned." });
    return data;
  }

  async insertRawSourceItem(input: RawSourceItemInsert, evidence: EvidenceNodeInsert): Promise<RawSourceItemRow> {
    await this.insertEvidenceNode(evidence);
    const { data, error } = await this.client
      .from("raw_source_items")
      .upsert(input, { onConflict: "source_key,external_id,payload_hash", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw databaseFailure("Raw source item could not be stored", error);
    if (data) return data;
    const existing = await this.client
      .from("raw_source_items")
      .select("*")
      .eq("source_key", input.source_key)
      .eq("external_id", input.external_id)
      .eq("payload_hash", input.payload_hash)
      .single();
    if (existing.error || !existing.data) throw databaseFailure("Raw source item was not returned", existing.error ?? { message: "No row returned." });
    return existing.data;
  }

  async getRawSourceItem(id: string): Promise<RawSourceItemRow | null> {
    const { data, error } = await this.client.from("raw_source_items").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseFailure("Raw source item could not be loaded", error);
    return data;
  }

  async listRawSourceItems(filter: RawSourceItemFilter): Promise<RawSourceItemRow[]> {
    let query = this.client.from("raw_source_items").select("*").order("fetched_at", { ascending: true });
    if (filter.sourceKey) query = query.eq("source_key", filter.sourceKey);
    if (filter.from) query = query.gte("fetched_at", filter.from);
    if (filter.to) query = query.lte("fetched_at", filter.to);
    if (filter.limit) query = query.limit(filter.limit);
    const { data, error } = await query;
    if (error) throw databaseFailure("Raw source items could not be listed", error);
    return data ?? [];
  }

  async upsertSourceItem(input: SourceItemInsert, evidence: EvidenceNodeInsert): Promise<SourceItemRow> {
    await this.insertEvidenceNode(evidence);
    const { data, error } = await this.client
      .from("source_items")
      .upsert(input, { onConflict: "source_key,external_id" })
      .select("*")
      .single();
    if (error || !data) throw databaseFailure("Source item could not be upserted", error ?? { message: "No row returned." });
    return data;
  }

  async getSourceItem(id: string): Promise<SourceItemRow | null> {
    const { data, error } = await this.client.from("source_items").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseFailure("Source item could not be loaded", error);
    return data;
  }

  async findConversationByKey(conversationKey: string): Promise<ConversationRow | null> {
    const { data, error } = await this.client.from("conversations").select("*").eq("conversation_key", conversationKey).maybeSingle();
    if (error) throw databaseFailure("Conversation could not be loaded", error);
    return data;
  }

  async findConversationByContentHash(contentHash: string): Promise<ConversationRow | null> {
    const { data, error } = await this.client.from("conversations").select("*").eq("content_hash", contentHash).maybeSingle();
    if (error) throw databaseFailure("Conversation candidate could not be loaded", error);
    return data;
  }

  async upsertConversation(input: ConversationInsert, evidence: EvidenceNodeInsert): Promise<ConversationRow> {
    await this.insertEvidenceNode(evidence);
    const { data, error } = await this.client
      .from("conversations")
      .upsert(input, { onConflict: "conversation_key" })
      .select("*")
      .single();
    if (error || !data) throw databaseFailure("Conversation could not be upserted", error ?? { message: "No row returned." });
    return data;
  }

  async upsertConversationSourceItem(input: ConversationSourceItemInsert): Promise<void> {
    const { error } = await this.client
      .from("conversation_source_items")
      .upsert(input, { onConflict: "conversation_id,source_item_id", ignoreDuplicates: true });
    if (error) throw databaseFailure("Conversation/source relationship could not be stored", error);
  }

  async clearConversationPrimary(conversationId: string): Promise<void> {
    const { error } = await this.client.from("conversation_source_items").update({ is_primary: false }).eq("conversation_id", conversationId);
    if (error) throw databaseFailure("Conversation primary relationship could not be updated", error);
  }

  async insertEvidenceProvenance(input: EvidenceProvenanceInsert): Promise<EvidenceProvenanceRow> {
    const { data, error } = await this.client
      .from("evidence_provenance")
      .upsert(input, { onConflict: "derived_evidence_node_id,source_evidence_node_id,relation_type,ordinal", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw databaseFailure("Evidence provenance could not be stored", error);
    if (data) return data;
    const fallback = await this.client.from("evidence_provenance").select("*").eq("id", input.id ?? "").maybeSingle();
    if (fallback.error || !fallback.data) throw databaseFailure("Evidence provenance was not returned", fallback.error ?? { message: "No row returned." });
    return fallback.data;
  }

  async upsertSourceHealth(input: SourceHealthInsert): Promise<SourceHealthRow> {
    const { data, error } = await this.client
      .from("source_health")
      .upsert(input, { onConflict: "source_key,environment" })
      .select("*")
      .single();
    if (error || !data) throw databaseFailure("Source health could not be stored", error ?? { message: "No row returned." });
    return data;
  }

  async getSourceHealth(sourceKey: string, environment: string): Promise<SourceHealthRow | null> {
    const { data, error } = await this.client
      .from("source_health")
      .select("*")
      .eq("source_key", sourceKey)
      .eq("environment", environment)
      .maybeSingle();
    if (error) throw databaseFailure("Source health could not be loaded", error);
    return data;
  }

  private async insertEvidenceNode(input: EvidenceNodeInsert): Promise<void> {
    const { error } = await this.client
      .from("evidence_nodes")
      .upsert(input, { onConflict: "entity_table,entity_id", ignoreDuplicates: true });
    if (error) throw databaseFailure("Evidence node could not be stored", error);
  }
}
