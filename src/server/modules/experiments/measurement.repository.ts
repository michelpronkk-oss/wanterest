import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ActionRow, ExperimentObservationRow, ExperimentPublicTokenRow, ExperimentResultRow, ExperimentRow, ExperimentVariantRow,
} from "../../db/database.helpers";
import type { Database, Json } from "../../db/database.types";
import { AppError } from "../../lib/errors";
import { CONCEPT_MARKET_STATE_POLICY_VERSION } from "../demand-intelligence/concept-market-state.policy";
import { SupabaseConceptMarketStateRepository } from "../demand-intelligence/concept-market-state.repository";
import { EXPERIMENT_LIST_LIMIT, EXPERIMENT_MEASUREMENT_PASS_LIMIT, EXPERIMENT_OBSERVATION_LIMIT } from "./measurement.schemas";

export type ArmCountRow = { variant_id: string; is_control: boolean; exposed: number; converted: number; excluded_events: number; days_with_exposure: number; window_days: number };
export type MarketContext = { evidenceNodeId: string; value: number };

/**
 * Layer 11 persistence port. Every write is a service-role RPC that re-checks
 * the actor's membership/role in the same transaction; callers authorize first.
 */
export type MeasurementRepository = {
  createExperiment(payload: Record<string, Json>, actorUserId: string, basisGuard: Json | null): Promise<ExperimentRow>;
  updateDraft(workspaceId: string, experimentId: string, actorUserId: string, plan: Record<string, Json>): Promise<ExperimentRow>;
  addVariant(workspaceId: string, experimentId: string, actorUserId: string, variant: Record<string, Json>): Promise<ExperimentVariantRow>;
  markReady(workspaceId: string, experimentId: string, actorUserId: string): Promise<ExperimentRow>;
  cancel(workspaceId: string, experimentId: string, actorUserId: string, note: string | null): Promise<ExperimentRow>;
  recordObservation(observation: Record<string, Json>, actorKind: "user" | "system", actorUserId: string | null): Promise<ExperimentObservationRow>;
  issueToken(workspaceId: string, experimentId: string, actorUserId: string, tokenId: string, publicKey: string, tokenHash: string): Promise<ExperimentPublicTokenRow>;
  revokeToken(workspaceId: string, tokenId: string, actorUserId: string): Promise<ExperimentPublicTokenRow>;
  armCounts(workspaceId: string, experimentId: string): Promise<ArmCountRow[]>;
  dueForMeasurement(now: Date, limit: number): Promise<ExperimentRow[]>;
  finalize(workspaceId: string, experimentId: string, result: Record<string, Json>, close: boolean, observationIds: string[]): Promise<ExperimentResultRow>;
  getExperiment(workspaceId: string, experimentId: string): Promise<ExperimentRow | null>;
  getAction(workspaceId: string, actionId: string): Promise<ActionRow | null>;
  /** Bounded (≤ 200) observations for one experiment, oldest first. */
  listObservations(workspaceId: string, experimentId: string): Promise<ExperimentObservationRow[]>;
  /** Go-live date from the Action's latest `completed` event metadata. */
  actionLiveSince(workspaceId: string, actionId: string): Promise<string | null>;
  /** Latest concept market state for the Action's concept (context only). */
  marketContext(action: ActionRow): Promise<MarketContext | null>;
  /** Bounded (≤ 100) experiments for one product with variants and current results, batched. */
  listForProduct(workspaceId: string, productId: string): Promise<Array<{ experiment: ExperimentRow; variants: ExperimentVariantRow[]; latestResult: ExperimentResultRow | null }>>;
};

const CONFLICT_REASONS = [
  "experiment_not_draft", "experiment_action_not_approved", "experiment_variants_locked", "experiment_token_not_allowed",
  "experiment_state_conflict", "experiment_not_collecting", "action_basis_changed", "action_status_conflict", "experiment_plan_frozen",
] as const;
const VALIDATION_REASONS = [
  "experiment_baseline_required", "experiment_controlled_setup_incomplete", "observation_window_invalid", "observation_form_mismatch",
  "observation_metric_invalid", "observation_supersession_invalid", "observation_source_invalid", "experiment_design_fixed_at_creation",
  "experiment_pause_not_supported", "experiment_event_outside_window", "experiment_action_fingerprint_mismatch", "action_basis_guard_required",
  "experiment_observation_limit", "experiment_result_limit", "experiments_measurement_v1_check", "invalid_experiment_payload", "invalid_observation_payload",
] as const;

/** Maps Layer 11 RPC exceptions to stable application errors (no provider detail leaks). */
export function experimentRpcError(error: { code?: string; message: string } | null, fallback: string): AppError {
  const message = error?.message ?? "";
  if (/experiment_not_found|experiment_token_not_found|action_not_found|experiment_action_not_found/.test(message)) return new AppError("NOT_FOUND", "Experiment was not found.");
  if (message.includes("experiment_actor_forbidden") || error?.code === "42501") return new AppError("FORBIDDEN", "You cannot change this experiment.");
  if (message.includes("usage_limit_exceeded")) return new AppError("USAGE_LIMIT_EXCEEDED", "The workspace experiment limit was reached.", 429, { entitlementCode: "EXPERIMENT_LIMIT_REACHED", capability: "experiments_max" });
  if (message.includes("usage_capability_disabled")) return new AppError("CAPABILITY_DISABLED", "Experiments are not enabled for this workspace plan.", 403, { capability: "experiments_max" });
  if (message.includes("experiment_action_rule") || error?.code === "23505") return new AppError("CONFLICT", "This Action already has an experiment.", 409, { reason: "experiment_exists_for_action" });
  for (const reason of CONFLICT_REASONS) if (message.includes(reason)) return new AppError("CONFLICT", fallback, 409, { reason });
  for (const reason of VALIDATION_REASONS) if (message.includes(reason)) return new AppError("VALIDATION_ERROR", fallback, 422, { reason });
  return new AppError("INTERNAL_ERROR", fallback, 500);
}

type Client = SupabaseClient<Database>;

export class SupabaseMeasurementRepository implements MeasurementRepository {
  constructor(private readonly client: Client) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T> {
    const { data, error } = await (this.client.rpc as unknown as (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(fn, args);
    if (error || data === null || data === undefined) throw experimentRpcError(error, fallback);
    return data as T;
  }

  createExperiment(payload: Record<string, Json>, actorUserId: string, basisGuard: Json | null) {
    return this.rpc<ExperimentRow>("create_experiment", { p_experiment: payload, p_actor_user_id: actorUserId, p_basis_guard: basisGuard }, "Experiment could not be created.");
  }
  updateDraft(workspaceId: string, experimentId: string, actorUserId: string, plan: Record<string, Json>) {
    return this.rpc<ExperimentRow>("update_experiment_draft", { p_workspace_id: workspaceId, p_experiment_id: experimentId, p_actor_user_id: actorUserId, p_plan: plan }, "Experiment plan could not be updated.");
  }
  addVariant(workspaceId: string, experimentId: string, actorUserId: string, variant: Record<string, Json>) {
    return this.rpc<ExperimentVariantRow>("add_experiment_variant", { p_workspace_id: workspaceId, p_experiment_id: experimentId, p_actor_user_id: actorUserId, p_variant: variant }, "Experiment variant could not be added.");
  }
  markReady(workspaceId: string, experimentId: string, actorUserId: string) {
    return this.rpc<ExperimentRow>("mark_experiment_ready", { p_workspace_id: workspaceId, p_experiment_id: experimentId, p_actor_user_id: actorUserId }, "Experiment could not be registered.");
  }
  cancel(workspaceId: string, experimentId: string, actorUserId: string, note: string | null) {
    return this.rpc<ExperimentRow>("cancel_experiment", { p_workspace_id: workspaceId, p_experiment_id: experimentId, p_actor_user_id: actorUserId, p_note: note }, "Experiment could not be canceled.");
  }
  recordObservation(observation: Record<string, Json>, actorKind: "user" | "system", actorUserId: string | null) {
    return this.rpc<ExperimentObservationRow>("record_experiment_observation", { p_observation: observation, p_actor_kind: actorKind, p_actor_user_id: actorUserId }, "Observation could not be recorded.");
  }
  issueToken(workspaceId: string, experimentId: string, actorUserId: string, tokenId: string, publicKey: string, tokenHash: string) {
    return this.rpc<ExperimentPublicTokenRow>("issue_experiment_token", { p_workspace_id: workspaceId, p_experiment_id: experimentId, p_actor_user_id: actorUserId, p_token_id: tokenId, p_public_key: publicKey, p_token_hash: tokenHash }, "Experiment token could not be issued.");
  }
  revokeToken(workspaceId: string, tokenId: string, actorUserId: string) {
    return this.rpc<ExperimentPublicTokenRow>("revoke_experiment_token", { p_workspace_id: workspaceId, p_token_id: tokenId, p_actor_user_id: actorUserId }, "Experiment token could not be revoked.");
  }
  async armCounts(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.rpc("experiment_arm_counts", { p_workspace_id: workspaceId, p_experiment_id: experimentId });
    if (error) throw experimentRpcError(error, "Experiment counts could not be loaded.");
    return (data ?? []) as ArmCountRow[];
  }
  async dueForMeasurement(now: Date, limit: number) {
    const { data, error } = await this.client.rpc("experiments_due_for_measurement", { p_now: now.toISOString(), p_limit: Math.min(limit, EXPERIMENT_MEASUREMENT_PASS_LIMIT) });
    if (error) throw experimentRpcError(error, "Due experiments could not be loaded.");
    return (data ?? []) as unknown as ExperimentRow[];
  }
  finalize(workspaceId: string, experimentId: string, result: Record<string, Json>, close: boolean, observationIds: string[]) {
    return this.rpc<ExperimentResultRow>("finalize_experiment_outcome", { p_workspace_id: workspaceId, p_experiment_id: experimentId, p_result: result, p_close: close, p_observation_ids: observationIds }, "Experiment outcome could not be stored.");
  }
  async getExperiment(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.from("experiments").select("*").eq("workspace_id", workspaceId).eq("id", experimentId).maybeSingle();
    if (error) throw experimentRpcError(error, "Experiment could not be loaded.");
    return data;
  }
  async getAction(workspaceId: string, actionId: string) {
    const { data, error } = await this.client.from("actions").select("*").eq("workspace_id", workspaceId).eq("id", actionId).maybeSingle();
    if (error) throw experimentRpcError(error, "Action could not be loaded.");
    return data;
  }
  async listObservations(workspaceId: string, experimentId: string) {
    const { data, error } = await this.client.from("experiment_observations").select("*").eq("workspace_id", workspaceId).eq("experiment_id", experimentId).order("recorded_at", { ascending: true }).limit(EXPERIMENT_OBSERVATION_LIMIT);
    if (error) throw experimentRpcError(error, "Observations could not be loaded.");
    return data ?? [];
  }
  async actionLiveSince(workspaceId: string, actionId: string) {
    const { data, error } = await this.client.from("action_events").select("metadata").eq("workspace_id", workspaceId).eq("action_id", actionId).eq("event_type", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw experimentRpcError(error, "Action completion could not be loaded.");
    const live = (data?.metadata as Record<string, unknown> | null | undefined)?.liveSince;
    return typeof live === "string" ? live : null;
  }
  async marketContext(action: ActionRow) {
    if (!action.trigger_clustering_version) return null;
    // Layer 9 public contract (read-only); the context never drives an outcome.
    const state = await new SupabaseConceptMarketStateRepository(this.client).latestMarketState(action.workspace_id, action.product_id, action.trigger_clustering_version, action.trigger_concept_key, CONCEPT_MARKET_STATE_POLICY_VERSION);
    return state ? { evidenceNodeId: state.evidence_node_id, value: state.distinct_evidence_count } : null;
  }
  async listForProduct(workspaceId: string, productId: string) {
    const { data: experiments, error } = await this.client.from("experiments").select("*").eq("workspace_id", workspaceId).eq("product_id", productId).order("created_at", { ascending: false }).limit(EXPERIMENT_LIST_LIMIT);
    if (error) throw experimentRpcError(error, "Experiments could not be loaded.");
    const rows = experiments ?? [];
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const resultIds = rows.map((row) => row.current_result_id).filter((id): id is string => Boolean(id));
    const [{ data: variants, error: variantError }, { data: results, error: resultError }] = await Promise.all([
      this.client.from("experiment_variants").select("*").eq("workspace_id", workspaceId).in("experiment_id", ids).order("created_at", { ascending: true }).limit(EXPERIMENT_LIST_LIMIT * 4),
      resultIds.length ? this.client.from("experiment_results").select("*").eq("workspace_id", workspaceId).in("id", resultIds).limit(EXPERIMENT_LIST_LIMIT) : Promise.resolve({ data: [] as ExperimentResultRow[], error: null }),
    ]);
    if (variantError || resultError) throw experimentRpcError(variantError ?? resultError, "Experiments could not be loaded.");
    return rows.map((experiment) => ({
      experiment,
      variants: (variants ?? []).filter((variant) => variant.experiment_id === experiment.id),
      latestResult: (results ?? []).find((result) => result.id === experiment.current_result_id) ?? null,
    }));
  }
}
