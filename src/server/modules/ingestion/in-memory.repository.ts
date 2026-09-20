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
import type { IngestionRepository, RawSourceItemFilter } from "./ingestion.repository";

function now(): string {
  return new Date().toISOString();
}

function merge<T extends object>(left: T, right: Partial<T>): T {
  return { ...left, ...right };
}

export class InMemoryIngestionRepository implements IngestionRepository {
  readonly jobs = new Map<string, JobRunRow>();
  readonly rawItems = new Map<string, RawSourceItemRow>();
  readonly sourceItems = new Map<string, SourceItemRow>();
  readonly conversations = new Map<string, ConversationRow>();
  readonly conversationSourceItems: ConversationSourceItemInsert[] = [];
  readonly evidenceNodes = new Map<string, EvidenceNodeInsert>();
  readonly provenance: EvidenceProvenanceRow[] = [];
  readonly health = new Map<string, SourceHealthRow>();

  async getJobRun(jobType: string, idempotencyKey: string): Promise<JobRunRow | null> {
    return this.jobs.get(`${jobType}:${idempotencyKey}`) ?? null;
  }

  async createJobRun(input: JobRunInsert): Promise<JobRunRow> {
    const key = `${input.job_type}:${input.idempotency_key}`;
    const existing = this.jobs.get(key);
    if (existing) return existing;
    const timestamp = now();
    const row: JobRunRow = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      trigger_run_id: input.trigger_run_id ?? null,
      workspace_id: input.workspace_id ?? null,
      product_id: input.product_id ?? null,
      input_reference: input.input_reference ?? {},
      status: input.status ?? "pending",
      attempt_count: input.attempt_count ?? 0,
      started_at: input.started_at ?? null,
      completed_at: input.completed_at ?? null,
      error_code: input.error_code ?? null,
      error_details: input.error_details ?? null,
      created_at: input.created_at ?? timestamp,
      updated_at: input.updated_at ?? timestamp,
    };
    this.jobs.set(key, row);
    return row;
  }

  async updateJobRun(id: string, input: JobRunUpdate): Promise<JobRunRow> {
    const entry = [...this.jobs.entries()].find(([, row]) => row.id === id);
    if (!entry) throw new Error("Job run not found.");
    const row = merge(entry[1], { ...input, updated_at: now() });
    this.jobs.set(entry[0], row);
    return row;
  }

  async insertRawSourceItem(input: RawSourceItemInsert, evidence: EvidenceNodeInsert): Promise<RawSourceItemRow> {
    this.evidenceNodes.set(`${evidence.entity_table}:${evidence.entity_id}`, evidence);
    const existing = [...this.rawItems.values()].find(
      (row) => row.source_key === input.source_key && row.external_id === input.external_id && row.payload_hash === input.payload_hash,
    );
    if (existing) return existing;
    const timestamp = now();
    const row: RawSourceItemRow = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      payload_json: input.payload_json ?? null,
      payload_uri: input.payload_uri ?? null,
      fetch_job_run_id: input.fetch_job_run_id ?? null,
      request_metadata: input.request_metadata ?? {},
      cursor_context: input.cursor_context ?? {},
      created_at: input.created_at ?? timestamp,
    };
    this.rawItems.set(row.id, row);
    return row;
  }

  async getRawSourceItem(id: string): Promise<RawSourceItemRow | null> {
    return this.rawItems.get(id) ?? null;
  }

  async listRawSourceItems(filter: RawSourceItemFilter): Promise<RawSourceItemRow[]> {
    return [...this.rawItems.values()]
      .filter((row) => !filter.sourceKey || row.source_key === filter.sourceKey)
      .filter((row) => !filter.from || row.fetched_at >= filter.from)
      .filter((row) => !filter.to || row.fetched_at <= filter.to)
      .sort((left, right) => left.fetched_at.localeCompare(right.fetched_at))
      .slice(0, filter.limit ?? 1000);
  }

  async upsertSourceItem(input: SourceItemInsert, evidence: EvidenceNodeInsert): Promise<SourceItemRow> {
    this.evidenceNodes.set(`${evidence.entity_table}:${evidence.entity_id}`, evidence);
    const existing = [...this.sourceItems.values()].find(
      (row) => row.source_key === input.source_key && row.external_id === input.external_id,
    );
    const timestamp = now();
    const row: SourceItemRow = {
      ...(existing ?? {}),
      ...input,
      id: input.id ?? existing?.id ?? crypto.randomUUID(),
      created_at: existing?.created_at ?? input.created_at ?? timestamp,
      updated_at: timestamp,
    } as SourceItemRow;
    if (existing) this.sourceItems.delete(existing.id);
    this.sourceItems.set(row.id, row);
    return row;
  }

  async getSourceItem(id: string): Promise<SourceItemRow | null> {
    return this.sourceItems.get(id) ?? null;
  }

  async findConversationByKey(conversationKey: string): Promise<ConversationRow | null> {
    return [...this.conversations.values()].find((row) => row.conversation_key === conversationKey) ?? null;
  }

  async findConversationByContentHash(contentHash: string): Promise<ConversationRow | null> {
    return [...this.conversations.values()].find((row) => row.content_hash === contentHash) ?? null;
  }

  async upsertConversation(input: ConversationInsert, evidence: EvidenceNodeInsert): Promise<ConversationRow> {
    this.evidenceNodes.set(`${evidence.entity_table}:${evidence.entity_id}`, evidence);
    const existing = await this.findConversationByKey(input.conversation_key);
    const timestamp = now();
    const row: ConversationRow = {
      ...(existing ?? {}),
      ...input,
      id: input.id ?? existing?.id ?? crypto.randomUUID(),
      created_at: existing?.created_at ?? input.created_at ?? timestamp,
      updated_at: timestamp,
    } as ConversationRow;
    if (existing) this.conversations.delete(existing.id);
    this.conversations.set(row.id, row);
    return row;
  }

  async upsertConversationSourceItem(input: ConversationSourceItemInsert): Promise<void> {
    const existing = this.conversationSourceItems.find(
      (row) => row.conversation_id === input.conversation_id && row.source_item_id === input.source_item_id,
    );
    if (!existing) this.conversationSourceItems.push({ ...input, created_at: input.created_at ?? now() });
  }

  async clearConversationPrimary(conversationId: string): Promise<void> {
    for (const row of this.conversationSourceItems) {
      if (row.conversation_id === conversationId) row.is_primary = false;
    }
  }

  async insertEvidenceProvenance(input: EvidenceProvenanceInsert): Promise<EvidenceProvenanceRow> {
    const existing = this.provenance.find(
      (row) => row.derived_evidence_node_id === input.derived_evidence_node_id &&
        row.source_evidence_node_id === input.source_evidence_node_id &&
        row.relation_type === input.relation_type && row.ordinal === input.ordinal,
    );
    if (existing) return existing;
    const row: EvidenceProvenanceRow = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      weight: input.weight ?? null,
      ordinal: input.ordinal ?? null,
      span: input.span ?? null,
      measurement: input.measurement ?? null,
      engine_version_id: input.engine_version_id ?? null,
      created_at: input.created_at ?? now(),
    };
    this.provenance.push(row);
    return row;
  }

  async upsertSourceHealth(input: SourceHealthInsert): Promise<SourceHealthRow> {
    const key = `${input.source_key}:${input.environment}`;
    const row: SourceHealthRow = {
      ...input,
      degradation_state: input.degradation_state ?? "healthy",
      last_failure_at: input.last_failure_at ?? null,
      last_latency_ms: input.last_latency_ms ?? null,
      last_success_at: input.last_success_at ?? null,
      latest_error_code: input.latest_error_code ?? null,
      latest_error_summary: input.latest_error_summary ?? null,
      rate_limit_state: input.rate_limit_state ?? {},
      updated_at: now(),
    };
    this.health.set(key, row);
    return row;
  }

  async getSourceHealth(sourceKey: string, environment: string): Promise<SourceHealthRow | null> {
    return this.health.get(`${sourceKey}:${environment}`) ?? null;
  }
}
