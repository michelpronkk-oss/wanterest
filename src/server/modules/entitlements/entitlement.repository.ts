import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, UsageLedgerRow, UsageType, WorkspaceEntitlementRow } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import type { EntitlementValue } from "./entitlement.schemas";

type Client = SupabaseClient<Database>;

function providerFailure(message: string, providerMessage?: string): AppError {
  return new AppError("INTERNAL_ERROR", message, 500, providerMessage ? { providerMessage } : undefined);
}

function decodeValue(row: WorkspaceEntitlementRow): EntitlementValue {
  if (row.value_type === "boolean" && typeof row.value_json === "boolean") return row.value_json;
  if (
    (row.value_type === "integer" || row.value_type === "decimal") &&
    typeof row.value_json === "number"
  ) {
    return row.value_json;
  }
  if (row.value_type === "enum" && typeof row.value_json === "string") return row.value_json;
  throw providerFailure("Stored entitlement data is invalid.");
}

export async function getWorkspaceEntitlement(
  client: Client,
  workspaceId: string,
  capability: string,
): Promise<{ row: WorkspaceEntitlementRow | null; value: EntitlementValue | null }> {
  const { data, error } = await client
    .from("workspace_entitlements")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("capability_key", capability)
    .is("effective_to", null)
    .maybeSingle();
  if (error) throw providerFailure("Entitlement could not be loaded.", error.message);
  return { row: data, value: data ? decodeValue(data) : null };
}

export async function consumeUsage(
  client: Client,
  input: {
    workspaceId: string;
    usageType: UsageType;
    amount: number;
    idempotencyKey: string;
    sourceMetadata: Record<string, unknown>;
    traceId?: string;
  },
): Promise<UsageLedgerRow> {
  const { data, error } = await client.rpc("consume_usage", {
    p_workspace_id: input.workspaceId,
    p_usage_type: input.usageType,
    p_amount: input.amount,
    p_idempotency_key: input.idempotencyKey,
    p_source_metadata: input.sourceMetadata as Json,
    p_actor_user_id: null,
    p_trace_id: input.traceId ?? null,
  });
  if (error) {
    if (error.code === "22003" || error.message.includes("usage_limit_exceeded")) {
      throw new AppError("USAGE_LIMIT_EXCEEDED", "The workspace usage limit was reached.");
    }
    if (error.code === "P0001" || error.message.includes("usage_capability_disabled")) {
      throw new AppError("CAPABILITY_DISABLED", "This workspace capability is not enabled.");
    }
    if (error.code === "42501" || error.message.includes("workspace_access_denied")) {
      throw new AppError("FORBIDDEN", "You cannot use this workspace.");
    }
    throw providerFailure("Usage could not be recorded.", error.message);
  }
  if (!data) throw providerFailure("Usage could not be recorded.");
  return data;
}

export async function getUsageTotals(
  client: Client,
  workspaceId: string,
  periodStart?: string,
): Promise<Array<{ usage_type: UsageType; amount: number }>> {
  const { data, error } = await client.rpc("get_usage_totals", {
    p_workspace_id: workspaceId,
    p_period_start: periodStart ?? null,
  });
  if (error) throw providerFailure("Usage totals could not be loaded.", error.message);
  return data ?? [];
}
