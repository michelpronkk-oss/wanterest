import "server-only";

/**
 * Wanterest 1B Stage 2B: minimal insert-if-absent repository for the global,
 * tenant-free `market_partitions` table. Rows are immutable (append-only,
 * enforced by a DB trigger); this repository never updates or deletes.
 *
 * Deliberately untyped against the generated Supabase client (same pattern
 * as QueryYieldRepository) so this file has no dependency on the generated
 * database types beyond the table/row shape it actually touches.
 */

export type MarketPartitionRow = {
  id: string;
  partitionKey: string;
  identityVersion: string;
  sourceKey: string;
  retrievalSpec: Record<string, unknown>;
};

type Row = Record<string, unknown>;
type ErrorResult = { code?: string; message?: string } | null;
type Query = {
  select(columns: string): Query;
  eq(field: string, value: unknown): Query;
  maybeSingle(): Promise<{ data: Row | null; error: ErrorResult }>;
  insert(row: Row): { select(columns: string): { maybeSingle(): Promise<{ data: Row | null; error: ErrorResult }> } };
};
type Client = { from(table: "market_partitions"): Query };

export class MarketPartitionRepository {
  constructor(private readonly client: unknown) {}

  private table(): Query {
    return (this.client as Client).from("market_partitions");
  }

  /**
   * Ensures exactly one global row exists for this partition key. A no-op if
   * the row already exists (read-before-write, then tolerates a concurrent
   * unique-violation insert from another scan as success). Never updates an
   * existing row - the retrieval spec for a given key is, by construction,
   * always identical.
   */
  async ensure(input: MarketPartitionRow): Promise<void> {
    const existing = await this.table().select("id").eq("partition_key", input.partitionKey).maybeSingle();
    if (existing.error) throw this.persistenceError(existing.error, "lookup");
    if (existing.data) return;
    const inserted = await this.table()
      .insert({
        id: input.id,
        partition_key: input.partitionKey,
        identity_version: input.identityVersion,
        source_key: input.sourceKey,
        retrieval_spec: input.retrievalSpec,
      })
      .select("id")
      .maybeSingle();
    if (!inserted.error) return;
    if (inserted.error.code === "23505") return;
    throw this.persistenceError(inserted.error, "insert");
  }

  private persistenceError(error: ErrorResult, context: string): Error {
    const code = error?.code ? ` (${error.code})` : "";
    const message = error?.message ? `: ${error.message.slice(0, 180)}` : "";
    return new Error(`Market partition persistence failed during ${context}${code}${message}`);
  }
}
