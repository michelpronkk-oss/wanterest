import "server-only";

import { getCurrentUser } from "../auth";
import { getProductQuery } from "../products";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { createSupabaseServerClient } from "../../providers/supabase/server";
import { getServerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import type { Json } from "../../db/database.types";
import { authorizeActionAccess } from "../actions/action-lifecycle.service";
import { actionAccessPorts, lifecycleService } from "../actions/commands";
import { authorizeExperimentAccess, ExperimentMeasurementService, type ExperimentAccessPorts } from "./experiment-measurement.service";
import { SupabaseMeasurementRepository } from "./measurement.repository";
import { EXPERIMENT_LIST_LIMIT } from "./measurement.schemas";

/**
 * Layer 11 experiment commands. Every mutation derives scope from the
 * experiment (or Action) itself through the caller's RLS-scoped client, checks
 * membership and role, and only then calls a service-role RPC that re-checks
 * the actor. No command accepts a browser workspace id. See docs Section 23.
 */

export function experimentMeasurementEnabled(): boolean {
  return getServerEnv().EXPERIMENT_MEASUREMENT_ENABLED === "true";
}

/** Service-role wiring used only AFTER the caller has been authorized against the experiment's own workspace. */
function measurementService(): ExperimentMeasurementService {
  return new ExperimentMeasurementService({
    repository: new SupabaseMeasurementRepository(createSupabaseServiceClient()),
    measurementEnabled: experimentMeasurementEnabled(),
    revalidateAction: async (action) => (await lifecycleService().revalidateForMeasurement(action)) as unknown as Json | null,
    now: () => new Date(),
  });
}

/** RLS/user-scoped reads only, so a foreign experiment id resolves to nothing. */
async function experimentAccessPorts(): Promise<ExperimentAccessPorts> {
  const client = await createSupabaseServerClient();
  return {
    currentUser: async () => { const user = await getCurrentUser(); return user ? { id: user.id } : null; },
    loadExperimentAsUser: async (experimentId) => {
      const { data, error } = await client.from("experiments").select("*").eq("id", experimentId).maybeSingle();
      if (error) throw new AppError("INTERNAL_ERROR", "Experiment could not be loaded.");
      return data;
    },
    loadMembershipAsUser: async (workspaceId, userId) => {
      const { data, error } = await client.from("workspace_members").select("role,status").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
      if (error) throw new AppError("INTERNAL_ERROR", "Workspace membership could not be loaded.");
      return data;
    },
  };
}

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" && key in input ? (input as Record<string, unknown>)[key] : undefined;
}

async function mutateAccess(input: unknown) {
  return authorizeExperimentAccess(await experimentAccessPorts(), field(input, "experimentId"), "mutate");
}

/** Create a draft measurement plan from one approved Action (scope from the Action via RLS). */
export async function createMeasurementExperimentCommand(input: unknown) {
  const access = await authorizeActionAccess(await actionAccessPorts(), field(input, "actionId"), "mutate");
  return measurementService().createFromAction(access, input);
}
export async function updateExperimentDraftCommand(input: unknown) { return measurementService().updateDraft(await mutateAccess(input), input); }
export async function addExperimentVariantCommand(input: unknown) { return measurementService().addVariant(await mutateAccess(input), input); }
export async function markExperimentReadyCommand(input: unknown) { return measurementService().markReady(await mutateAccess(input)); }
export async function cancelExperimentCommand(input: unknown) { return measurementService().cancel(await mutateAccess(input), input); }
export async function recordExperimentObservationCommand(input: unknown) { return measurementService().recordManualObservation(await mutateAccess(input), input); }
export async function issueExperimentTokenCommand(input: unknown) { return measurementService().issueToken(await mutateAccess(input)); }
export async function revokeExperimentTokenCommand(input: unknown) { return measurementService().revokeToken(await mutateAccess(input), input); }

/**
 * Product-scoped list, capped at 100 with batched variant/result reads.
 * Membership is enforced by the RLS-backed product lookup; the service-role
 * read uses only the product's own workspace.
 */
export async function listExperimentsQuery(workspaceId: unknown, productId: unknown) {
  const product = await getProductQuery(workspaceId, productId);
  return new SupabaseMeasurementRepository(createSupabaseServiceClient()).listForProduct(product.workspace_id, product.id);
}

/** Running experiments visible to the caller (RLS-scoped, capped). */
export async function getActiveExperimentsQuery(workspaceId: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("experiments").select("id,product_id,status").eq("workspace_id", workspaceId).eq("status", "running").limit(EXPERIMENT_LIST_LIMIT);
  if (error) throw new AppError("INTERNAL_ERROR", "Experiments could not be loaded.");
  return data ?? [];
}
