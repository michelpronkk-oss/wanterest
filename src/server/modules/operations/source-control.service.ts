import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import type { SourceControlInsert, SourceControlRow } from "../../db/database.helpers";
import { AppError } from "../../lib/errors";
import { getSourceRuntimeConfiguration } from "../../providers/source/runtime";

export type SourceControlState = SourceControlRow["state"];
export type SourceControlStore = {
  get(sourceKey: string): Promise<SourceControlRow | null>;
  upsert(input: SourceControlInsert): Promise<SourceControlRow>;
};

export class InMemorySourceControlStore implements SourceControlStore {
  readonly rows = new Map<string, SourceControlRow>();
  async get(sourceKey: string) { return this.rows.get(sourceKey) ?? null; }
  async upsert(input: SourceControlInsert) {
    const previous = this.rows.get(input.source_key);
    const now = new Date().toISOString();
    const row = { source_key: input.source_key, state: input.state ?? "enabled", reason: input.reason ?? null, next_retry_at: input.next_retry_at ?? null, failure_count: input.failure_count ?? 0, updated_by: input.updated_by ?? null, created_at: previous?.created_at ?? now, updated_at: now } as SourceControlRow;
    this.rows.set(row.source_key, row);
    return row;
  }
}

export class SupabaseSourceControlStore implements SourceControlStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async get(sourceKey: string) { const { data, error } = await this.client.from("source_controls").select("*").eq("source_key", sourceKey).maybeSingle(); if (error) throw new AppError("INTERNAL_ERROR", "Source control could not be loaded.", 500, { providerMessage: error.message }); return data; }
  async upsert(input: SourceControlInsert) { const { data, error } = await this.client.from("source_controls").upsert(input).select("*").single(); if (error || !data) throw new AppError("INTERNAL_ERROR", "Source control could not be stored.", 500, error ? { providerMessage: error.message } : undefined); return data; }
}

export class SourceControlService {
  constructor(private readonly store: SourceControlStore) {}
  async get(sourceKey: string) { return (await this.store.get(sourceKey)) ?? { source_key: sourceKey, state: "enabled" as const, reason: null, next_retry_at: null, failure_count: 0, updated_by: null, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }; }
  async setState(sourceKey: string, state: SourceControlState, reason?: string, updatedBy?: string) { if (!/^[a-z][a-z0-9_-]*$/.test(sourceKey)) throw new AppError("VALIDATION_ERROR", "Invalid source key."); return this.store.upsert({ source_key: sourceKey, state, reason: reason ?? null, updated_by: updatedBy ?? null }); }
  async assertDiscoverable(sourceKey: string) { const row = await this.get(sourceKey); if (row.state !== "enabled") throw new AppError("CONFLICT", `Source ${sourceKey} is ${row.state}.`, 409, { sourceKey, state: row.state, reason: row.reason }); if (row.next_retry_at && row.next_retry_at > new Date().toISOString()) throw new AppError("CONFLICT", `Source ${sourceKey} is waiting for its next retry window.`, 409, { sourceKey, nextRetryAt: row.next_retry_at }); }
  async recordFailure(sourceKey: string, reason: string, nextRetryAt?: string) { const row = await this.get(sourceKey); return this.store.upsert({ source_key: sourceKey, state: row.state, reason: reason.slice(0, 500), failure_count: row.failure_count + 1, next_retry_at: nextRetryAt ?? null }); }
  async recordSuccess(sourceKey: string) { const row = await this.get(sourceKey); return this.store.upsert({ source_key: sourceKey, state: row.state, reason: null, failure_count: 0, next_retry_at: null }); }
}

export type SourceAvailability = { sourceKey: string; configured: boolean; state: SourceControlState; reason?: string };
const expansionAvailability: SourceAvailability[] = ["product-hunt", "stack-exchange", "public-web", "g2", "trustpilot", "youtube", "gitlab"].map((sourceKey) => {
  const runtime = getSourceRuntimeConfiguration(sourceKey);
  return { sourceKey, configured: runtime.configured, state: runtime.configured ? "enabled" : "disabled", reason: runtime.reason };
});

export const initialSourceAvailability: SourceAvailability[] = [
  { sourceKey: "fixture", configured: true, state: "enabled" },
  { sourceKey: "hacker-news", configured: true, state: "enabled" },
  { sourceKey: "bluesky", configured: true, state: "enabled" },
  { sourceKey: "reddit", configured: false, state: "disabled", reason: "approval_pending_or_credentials_missing" },
  { sourceKey: "github", configured: true, state: "enabled", reason: "public_api_available" },
  { sourceKey: "x", configured: Boolean(process.env.X_BEARER_TOKEN?.trim()), state: process.env.X_BEARER_TOKEN?.trim() ? "enabled" : "disabled", reason: process.env.X_BEARER_TOKEN?.trim() ? "app_only_token_configured" : "credentials_missing" },
  ...expansionAvailability,
];
