import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import { AppError } from "../../lib/errors";

export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number };
export type RateLimitStore = { consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> };

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();
  async consume(key: string, limit: number, windowMs: number) { const now = Date.now(); const current = this.buckets.get(key); if (!current || now - current.startedAt >= windowMs) { this.buckets.set(key, { startedAt: now, count: 1 }); return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }; } if (current.count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((windowMs - (now - current.startedAt)) / 1000) }; current.count += 1; return { allowed: true, remaining: limit - current.count, retryAfterSeconds: 0 }; }
}

export class SupabaseRateLimitStore implements RateLimitStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async consume(key: string, limit: number, windowMs: number) { const { data, error } = await this.client.rpc("consume_phase7_rate_limit", { p_bucket_key: key, p_limit: limit, p_window_seconds: Math.ceil(windowMs / 1000) }); const row = Array.isArray(data) ? data[0] : data; if (error || !row) throw new AppError("INTERNAL_ERROR", "Rate limit state could not be updated.", 500, error ? { providerMessage: error.message } : undefined); return { allowed: row.allowed, remaining: row.remaining, retryAfterSeconds: row.retry_after_seconds }; }
}

export async function enforceRateLimit(store: RateLimitStore, key: string, limit: number, windowMs: number): Promise<RateLimitDecision> { const decision = await store.consume(key, limit, windowMs); if (!decision.allowed) throw new AppError("RATE_LIMITED", "Too many requests. Try again later.", 429, { retryAfterSeconds: decision.retryAfterSeconds }); return decision; }
