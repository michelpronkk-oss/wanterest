import "server-only";

export type ShadowReasoningKey = { workspaceId: string; productId: string; conversationId: string; fingerprint: string; routerVersion: string; reasoningVersion: string; promptSchemaVersion: string };
export type ShadowReasoningInsert = ShadowReasoningKey & Record<string, unknown>;
type ShadowReasoningRow = Record<string, unknown>;
type ShadowReasoningError = { code?: string } | null;
type ShadowReasoningQuery = {
  select(columns: string): ShadowReasoningQuery;
  eq(field: string, value: unknown): ShadowReasoningQuery;
  in(field: string, values: string[]): ShadowReasoningQuery;
  is(field: string, value: null): ShadowReasoningQuery;
  update(row: ShadowReasoningRow): ShadowReasoningQuery;
  maybeSingle(): Promise<{ data: ShadowReasoningRow | null; error: ShadowReasoningError }>;
  order(field: string, options: { ascending: boolean }): Promise<{ data: ShadowReasoningRow[] | null; error: ShadowReasoningError }>;
  insert(row: ShadowReasoningRow): { select(columns: string): { maybeSingle(): Promise<{ data: ShadowReasoningRow | null; error: ShadowReasoningError }> } };
};
type ShadowReasoningClient = { from(table: "semantic_shadow_reasoning"): ShadowReasoningQuery };

/** Immutable, workspace-scoped cache for shadow-only semantic reasoning. */
export class SemanticShadowReasoningRepository {
  constructor(private readonly client: unknown) {}

  private table(): ShadowReasoningQuery {
    return (this.client as ShadowReasoningClient).from("semantic_shadow_reasoning");
  }

  async findByFingerprint(key: ShadowReasoningKey) {
    const { data, error } = await this.table().select("*")
      .eq("workspace_id", key.workspaceId).eq("product_id", key.productId).eq("conversation_id", key.conversationId)
      .eq("fingerprint", key.fingerprint).eq("router_version", key.routerVersion).eq("reasoning_version", key.reasoningVersion).eq("prompt_schema_version", key.promptSchemaVersion)
      .in("execution_status", ["success", "cache_hit"]).maybeSingle();
    if (error) throw new Error("Shadow reasoning cache lookup failed.");
    return data;
  }

  async insertImmutable(input: ShadowReasoningInsert) {
    const { workspaceId, productId, conversationId, routerVersion, reasoningVersion, promptSchemaVersion, ...rest } = input;
    const row = { ...rest, workspace_id: workspaceId, product_id: productId, conversation_id: conversationId, router_version: routerVersion, reasoning_version: reasoningVersion, prompt_schema_version: promptSchemaVersion };
    const { data, error } = await this.table().insert(row).select("*").maybeSingle();
    if (!error && data) return data;
    if (error?.code === "23505") {
      const existing = await this.findByFingerprint(input);
      if (existing) return existing;
    }
    throw new Error("Shadow reasoning persistence failed.");
  }

  async loadForReplay(input: Pick<ShadowReasoningKey, "workspaceId" | "productId" | "conversationId">) {
    const { data, error } = await this.table().select("*").eq("workspace_id", input.workspaceId).eq("product_id", input.productId).eq("conversation_id", input.conversationId).order("created_at", { ascending: false });
    if (error) throw new Error("Shadow reasoning replay load failed.");
    return data ?? [];
  }

  /**
   * Comparison fields are a one-time, nullable calibration attachment. Semantic
   * provider output remains immutable and an existing comparison is never overwritten.
   */
  async persistComparison(input: ShadowReasoningKey & { actualStatus: string; actualReasonCodes: unknown; shadowStatus: string; shadowReasonCodes: unknown; impact: unknown }) {
    const { data, error } = await this.table().update({
      actual_qualification_status: input.actualStatus,
      actual_reason_codes: input.actualReasonCodes,
      shadow_qualification_status: input.shadowStatus,
      shadow_reason_codes: input.shadowReasonCodes,
      shadow_impact: input.impact,
    })
      .eq("workspace_id", input.workspaceId).eq("product_id", input.productId).eq("conversation_id", input.conversationId)
      .eq("fingerprint", input.fingerprint).eq("router_version", input.routerVersion).eq("reasoning_version", input.reasoningVersion).eq("prompt_schema_version", input.promptSchemaVersion)
      .eq("execution_status", "success").is("actual_qualification_status", null).select("*").maybeSingle();
    if (error) throw new Error("Shadow reasoning comparison persistence failed.");
    if (data) return data;
    return this.findByFingerprint(input);
  }
}
