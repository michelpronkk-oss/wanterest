import { describe, expect, it, vi } from "vitest";

import {
  buildProductFact, buildRefreshFact, disabledSignalSupplyTelemetry, providerCost, reasoningCost, signalSupplyTelemetryEnabled,
  signalSupplyTelemetryFor, supabaseSignalSupplyTelemetry, SIGNAL_SUPPLY_TELEMETRY_VERSION, type ProductFactInput, type RefreshFactInput,
} from "../../src/server/modules/operations/signal-supply-telemetry";

const refreshInput = (overrides: Partial<RefreshFactInput> = {}): RefreshFactInput => ({
  jobRunId: "11111111-1111-4111-8111-111111111111", marketPartitionId: "22222222-2222-4222-8222-222222222222", partitionKey: "market_partition_identity_v1:abc",
  sourceKey: "github", refreshStatus: "succeeded", executionStatus: "completed_with_results", startedAt: "2026-09-26T01:00:00.000Z", finishedAt: "2026-09-26T01:00:05.000Z",
  rawItems: 10, rawNewItems: 4, normalizedItems: 10, conversationIds: ["a", "b", "b", "c"], newCanonicalCount: 2, pagesCompleted: 1, providerRequestCount: null,
  estimatedCost: null, durationMs: 5000, ...overrides,
});

const productInput = (overrides: Partial<ProductFactInput> = {}): ProductFactInput => ({
  workspaceId: "w", productId: "p", jobRunId: "j", refreshJobRunId: "r", marketPartitionId: "m", partitionKey: "k", sourceKey: "github",
  refreshConversationCount: 10, alreadyMatchedCount: 4, candidateCount: 6, overflowCount: 0, selectedCount: 5, evaluatedCount: 5,
  outcomeStatuses: ["qualified", "weak_candidate", "weak_candidate", "rejected", null, "rejected"], materializedCount: 1, demandRebuilt: true,
  clustersCreated: 1, clusterMembershipsCreated: 3, reasoningCalls: 0, reasoningCostUsd: null, startedAt: "2026-09-26T01:00:00.000Z", finishedAt: "2026-09-26T01:00:02.000Z",
  ...overrides,
});

describe("signal supply telemetry v1 — pure facts", () => {
  it("is off unless the flag is exactly \"true\"", () => {
    expect(signalSupplyTelemetryEnabled({})).toBe(false);
    expect(signalSupplyTelemetryEnabled({ SIGNAL_SUPPLY_TELEMETRY_ENABLED: "false" })).toBe(false);
    expect(signalSupplyTelemetryEnabled({ SIGNAL_SUPPLY_TELEMETRY_ENABLED: "TRUE" })).toBe(false);
    expect(signalSupplyTelemetryEnabled({ SIGNAL_SUPPLY_TELEMETRY_ENABLED: "true" })).toBe(true);
    expect(signalSupplyTelemetryFor({} as never, {})).toBe(disabledSignalSupplyTelemetry);
  });

  it("cost units are explicit: YouTube quota units are never USD, unknown stays unknown and never mixes", () => {
    expect(providerCost("youtube", 101)).toEqual({ value: 101, unit: "quota_units" });
    expect(providerCost("x", 3.1)).toEqual({ value: 3.1, unit: "usd" });
    expect(providerCost("github", null)).toEqual({ value: null, unit: "unknown" });
    // A number from a source whose unit is not known is dropped rather than mislabeled.
    expect(providerCost("github", 7)).toEqual({ value: null, unit: "unknown" });
    expect(providerCost("youtube", Number.NaN)).toEqual({ value: null, unit: "unknown" });
    expect(providerCost("x", -1)).toEqual({ value: null, unit: "unknown" });
    expect(reasoningCost(0.012)).toEqual({ value: 0.012, unit: "usd" });
    expect(reasoningCost(null)).toEqual({ value: null, unit: "unknown" });
  });

  it("refresh fact: counts come only from what the refresh computed; canonical split sums to unique conversations", () => {
    const fact = buildRefreshFact(refreshInput());
    expect(fact).toMatchObject({
      telemetry_version: SIGNAL_SUPPLY_TELEMETRY_VERSION, raw_count: 10, raw_new_count: 4, normalized_count: 10, unique_conversation_count: 3,
      new_canonical_count: 2, reused_canonical_count: 1, pages_completed: 1, provider_request_count: null, provider_cost_value: null, provider_cost_unit: "unknown", latency_ms: 5000,
    });
    // Unobservable split stays null on both sides (not 0).
    expect(buildRefreshFact(refreshInput({ newCanonicalCount: null }))).toMatchObject({ new_canonical_count: null, reused_canonical_count: null });
    // Defensive clamps never invent data: raw_new cannot exceed raw, new canonical cannot exceed unique.
    expect(buildRefreshFact(refreshInput({ rawNewItems: 99, newCanonicalCount: 50 }))).toMatchObject({ raw_new_count: 10, new_canonical_count: 3, reused_canonical_count: 0 });
    expect(buildRefreshFact(refreshInput({ sourceKey: "youtube", estimatedCost: 101 }))).toMatchObject({ provider_cost_value: 101, provider_cost_unit: "quota_units" });
  });

  it("product fact: weak/rejected/qualified are counted from evaluated outcomes; unknowns remain null", () => {
    const fact = buildProductFact(productInput());
    expect(fact).toMatchObject({ qualified_count: 1, weak_count: 2, rejected_count: 2, evaluated_count: 5, materialized_count: 1, clusters_created_count: 1, cluster_memberships_created_count: 3, reasoning_call_count: 0, reasoning_cost_unit: "unknown" });
    expect(buildProductFact(productInput({ clustersCreated: null, clusterMembershipsCreated: null, reasoningCalls: null }))).toMatchObject({ clusters_created_count: null, cluster_memberships_created_count: null, reasoning_call_count: null });
    expect(buildProductFact(productInput({ reasoningCostUsd: 0.02 }))).toMatchObject({ reasoning_cost_value: 0.02, reasoning_cost_unit: "usd" });
  });
});

describe("signal supply telemetry v1 — writer", () => {
  function fakeClient(options: { error?: boolean; throws?: boolean; created?: number } = {}) {
    const upserts: Array<{ table: string; row: unknown; options: unknown }> = [];
    const client = {
      from(table: string) {
        return {
          upsert: async (row: unknown, opts: unknown) => {
            if (options.throws) throw new Error("network down");
            upserts.push({ table, row, options: opts });
            return { error: options.error ? { message: "boom" } : null };
          },
          select: () => ({ in: () => ({ gte: async () => ({ count: options.created ?? 0, error: null }) }) }),
        };
      },
    };
    return { client, upserts };
  }

  it("insert-or-ignore on the job identity (never '+=') for both fact tables", async () => {
    const { client, upserts } = fakeClient();
    const writer = supabaseSignalSupplyTelemetry(client as never);
    await expect(writer.recordRefresh(refreshInput())).resolves.toEqual({ written: true });
    await expect(writer.recordProduct(productInput())).resolves.toEqual({ written: true });
    expect(upserts.map((entry) => [entry.table, entry.options])).toEqual([
      ["supply_refresh_facts", { onConflict: "job_run_id", ignoreDuplicates: true }],
      ["product_supply_facts", { onConflict: "job_run_id", ignoreDuplicates: true }],
    ]);
  });

  it("is best-effort: database errors and thrown errors are reported, never propagated", async () => {
    await expect(supabaseSignalSupplyTelemetry(fakeClient({ error: true }).client as never).recordRefresh(refreshInput())).resolves.toEqual({ written: false, reason: "error" });
    await expect(supabaseSignalSupplyTelemetry(fakeClient({ throws: true }).client as never).recordProduct(productInput())).resolves.toEqual({ written: false, reason: "error" });
  });

  it("new-canonical lookup is bounded and returns null (unknown) rather than guessing", async () => {
    const writer = supabaseSignalSupplyTelemetry(fakeClient({ created: 2 }).client as never);
    await expect(writer.countNewCanonical([], "2026-09-26T00:00:00.000Z")).resolves.toBe(0);
    await expect(writer.countNewCanonical(["a", "b", "b"], "2026-09-26T00:00:00.000Z")).resolves.toBe(2);
    await expect(writer.countNewCanonical(Array.from({ length: 501 }, (_, index) => `c${index}`), "2026-09-26T00:00:00.000Z")).resolves.toBeNull();
  });

  it("disabled writer performs no reads and no writes", async () => {
    const spy = vi.fn();
    expect(await disabledSignalSupplyTelemetry.recordRefresh(refreshInput())).toEqual({ written: false, reason: "disabled" });
    expect(await disabledSignalSupplyTelemetry.recordProduct(productInput())).toEqual({ written: false, reason: "disabled" });
    expect(await disabledSignalSupplyTelemetry.countNewCanonical(["a"], "x")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
