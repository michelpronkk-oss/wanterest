import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import type { Database } from "../../src/server/db/database.types";
import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { backlogFingerprint, claimBacklog, enqueueCapSuppressed, settleBacklog, type BacklogRow } from "../../src/server/modules/operations/evaluation-backlog.repository";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (letter: string) => letter.repeat(64);
const candidate = (n: number) => ({
  conversation: { id: id(n), primary_source_item_id: id(n + 1000), content_hash: hash("a") } as ConversationRow,
  source: { id: id(n + 1000), content_hash: hash("b"), status: "active" } as SourceItemRow,
  score: 0.7, rank: n, provenance: [],
});
const base = { productId: id(9000), productName: "Product", workspaceId: id(9001), profileId: id(9002),
  classifierVersionId: id(9003), matcherVersionId: id(9004), groundingEnabled: false };

function clientFixture(options: { completed?: boolean } = {}) {
  const keys = new Set<string>();
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      let value: Record<string, unknown> | null = null;
      const query = {
        select() { return query; }, eq() { return query; }, contains() { return query; }, limit() { return query; },
        upsert(input: Record<string, unknown>) { value = input; return query; },
        maybeSingle: async () => table === "conversation_analysis"
          ? { data: options.completed ? { id: id(8000) } : null, error: null }
          : { data: table === "product_match_evaluations" && options.completed ? { id: id(8100) } : null, error: null },
        then(resolve: (value: unknown) => unknown) {
          if (table !== "evaluation_backlog" || !value) return Promise.resolve({ data: [], error: null }).then(resolve);
          const key = `${value.product_id}:${value.conversation_id}:${value.demand_profile_id}:${value.selection_fingerprint}`;
          if (keys.has(key)) return Promise.resolve({ data: [], error: null }).then(resolve);
          keys.add(key); inserted.push(value);
          return Promise.resolve({ data: [{ id: id(7000 + inserted.length) }], error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, inserted };
}

describe("durable evaluation backlog", () => {
  it("keys repeated scans to the same root, profile, source evidence and evaluator versions", () => {
    const first = candidate(1);
    const input = { ...base, profileId: base.profileId, conversation: first.conversation, source: first.source, provenance: [] };
    const fingerprint = backlogFingerprint(input);
    expect(backlogFingerprint({ ...input, provenance: [{ conversationId: first.conversation.id, queryPlanId: "scan-a", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false }] }))
      .toBe(backlogFingerprint({ ...input, provenance: [{ conversationId: first.conversation.id, queryPlanId: "scan-b", source: "github", queryFamily: "pain", demandSurface: "pain_first", concepts: [], competitorSpecific: false }] }));
    expect(backlogFingerprint({ ...input, profileId: id(9990) })).not.toBe(fingerprint);
    expect(backlogFingerprint({ ...input, source: { ...first.source, content_hash: hash("c") } })).not.toBe(fingerprint);
    expect(backlogFingerprint({ ...input, matcherVersionId: id(9991) })).not.toBe(fingerprint);
  });

  it("enqueues cap-eligible roots once across retries without truncating a growing queue", async () => {
    const { client, inserted } = clientFixture();
    const candidates = Array.from({ length: 120 }, (_, index) => candidate(index + 1));
    expect(await enqueueCapSuppressed(client, { ...base, candidates })).toBe(120);
    expect(await enqueueCapSuppressed(client, { ...base, candidates })).toBe(0);
    expect(inserted).toHaveLength(120);
    expect(inserted[0]).toMatchObject({ conversation_id: id(1), priority_score: 0.7, selection_rank: 1 });
    expect(inserted[0]).not.toHaveProperty("body");
    expect(inserted[0]).not.toHaveProperty("author_external_id");
  });

  it("does not enqueue a root already evaluated under the current deterministic profile", async () => {
    const { client, inserted } = clientFixture({ completed: true });
    expect(await enqueueCapSuppressed(client, { ...base, candidates: [candidate(1)] })).toBe(0);
    expect(await enqueueCapSuppressed(client, { ...base, groundingEnabled: true, candidates: [candidate(1)] })).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("claims only a bounded batch and validates the lease request", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const client = { rpc } as unknown as SupabaseClient<Database>;
    expect(await claimBacklog(client, id(1), 5)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("claim_evaluation_backlog", { p_owner: id(1), p_limit: 5 });
    await expect(claimBacklog(client, id(1), 11)).rejects.toThrow("batch limit");
  });

  it("backs off failed work and exhausts at the third attempt without releasing a stale owner", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const client = { from() { const q = { update(value: Record<string, unknown>) { updates.push(value); return q; }, eq() { return q; }, select() { return q; }, maybeSingle: async () => ({ data: { id: id(1) }, error: null }) }; return q; } } as unknown as SupabaseClient<Database>;
    const row = { id: id(1), workspace_id: id(2), available_at: new Date().toISOString(), attempt_count: 1 } as BacklogRow;
    await settleBacklog(client, row, id(3), { status: "retryable", code: "EVALUATION_FAILED" });
    await settleBacklog(client, { ...row, attempt_count: 3 }, id(3), { status: "retryable", code: "EVALUATION_FAILED" });
    expect(updates[0]).toMatchObject({ status: "retryable", lease_owner: null, last_error_code: "EVALUATION_FAILED" });
    expect(updates[1]).toMatchObject({ status: "exhausted", lease_owner: null, last_error_code: "EVALUATION_FAILED" });
  });

  it("never imports acquisition or scan dispatch into the bounded worker", () => {
    const worker = readFileSync(path.resolve(process.cwd(), "src/server/modules/operations/evaluation-backlog.processor.ts"), "utf8");
    expect(worker).toContain("processScanCandidates");
    expect(worker).not.toMatch(/ingestPublicPartition|discoverProductSourceTask|productDemandScanTask|requestProductDemandScanCommand/);
  });
});
