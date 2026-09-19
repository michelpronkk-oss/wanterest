import { requireUser } from "@/server/modules/auth";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { AppError } from "@/server/lib/errors";
import {
  consumeUsageInputSchema,
  capabilitySchema,
  workspaceIdSchema,
  type ConsumeUsageInput,
} from "./entitlement.schemas";
import { consumeUsage, getUsageTotals, getWorkspaceEntitlement } from "./entitlement.repository";
import { capabilityAllows } from "./entitlement-policy";

export async function can(workspaceId: string, capability: string): Promise<boolean> {
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  const parsedCapability = capabilitySchema.safeParse(capability);
  if (!parsedWorkspaceId.success || !parsedCapability.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid entitlement lookup.");
  }
  await requireUser();
  const { value } = await getWorkspaceEntitlement(
    await createSupabaseServerClient(),
    parsedWorkspaceId.data,
    parsedCapability.data,
  );
  return capabilityAllows(value);
}

export async function limit(workspaceId: string, entitlement: string) {
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  const parsedEntitlement = capabilitySchema.safeParse(entitlement);
  if (!parsedWorkspaceId.success || !parsedEntitlement.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid entitlement lookup.");
  }
  await requireUser();
  const { value } = await getWorkspaceEntitlement(
    await createSupabaseServerClient(),
    parsedWorkspaceId.data,
    parsedEntitlement.data,
  );
  return value;
}

export async function consume(workspaceId: string, input: Omit<ConsumeUsageInput, "workspaceId">) {
  const parsed = consumeUsageInputSchema.safeParse({ ...input, workspaceId });
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid usage input.", 422, {
      issues: parsed.error.issues,
    });
  }
  await requireUser();
  return consumeUsage(await createSupabaseServerClient(), parsed.data);
}

export async function usageTotals(workspaceId: string, periodStart?: string) {
  if (!workspaceIdSchema.safeParse(workspaceId).success) {
    throw new AppError("VALIDATION_ERROR", "Invalid workspace ID.");
  }
  await requireUser();
  return getUsageTotals(await createSupabaseServerClient(), workspaceId, periodStart);
}

export function parseConsumeUsageInput(input: unknown): ConsumeUsageInput {
  const parsed = consumeUsageInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid usage input.", 422, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}
