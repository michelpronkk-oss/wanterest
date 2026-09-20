import { requireUser } from "@/server/modules/auth";
import { AppError } from "@/server/lib/errors";
import { getServerEnv } from "@/server/lib/env";
import { getTraceId } from "@/server/lib/request-context";
import { jsonObjectSchema } from "@/server/db/database.helpers";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { createSupabaseBillingServiceClient } from "@/server/providers/supabase/service";
import { recordAuditEvent } from "../observability/audit.service";
import { DodoBillingProvider } from "@/server/providers/billing/dodo/adapter";
import type { WebhookHeaders } from "@/server/providers/billing/contracts";
import { SupabaseBillingRepository } from "./billing.repository";
import { BillingService } from "./billing.service";
import { changePlanInputSchema, createCheckoutInputSchema, workspaceIdSchema } from "./billing.schemas";
import { getDodoProductCatalog } from "./product-mapping";

async function assertWorkspaceRole(workspaceId: string, roles: string[]) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("has_workspace_role", { p_workspace_id: workspaceId, p_roles: roles });
  if (error) throw new AppError("INTERNAL_ERROR", "Workspace authorization could not be checked.");
  if (!data) throw new AppError("FORBIDDEN", "Only workspace owners may manage billing.");
}

async function assertWorkspaceMember(workspaceId: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("is_workspace_member", { p_workspace_id: workspaceId });
  if (error) throw new AppError("INTERNAL_ERROR", "Workspace authorization could not be checked.");
  if (!data) throw new AppError("FORBIDDEN", "You cannot access this workspace billing state.");
}

function provider() {
  const env = getServerEnv();
  const webhookSecret = env.DODO_WEBHOOK_SECRET;
  if (!webhookSecret) throw new AppError("INTERNAL_ERROR", "Dodo webhook configuration is missing.");
  return new DodoBillingProvider({
    apiKey: env.DODO_PAYMENTS_API_KEY ?? "webhook-only",
    webhookSecret,
    baseUrl: env.DODO_API_BASE_URL ?? (env.DODO_PAYMENTS_ENVIRONMENT === "test_mode" ? "https://test.dodopayments.com" : "https://live.dodopayments.com"),
    catalog: getDodoProductCatalog(),
  });
}

async function service(actorUserId?: string) {
  const client = createSupabaseBillingServiceClient();
  const repository = new SupabaseBillingRepository(client);
  const catalog = getDodoProductCatalog();
  const audit = actorUserId
    ? async (input: { workspaceId: string; action: string; targetType: string; targetId?: string; metadata?: Record<string, unknown> }) => {
        await recordAuditEvent({
          workspaceId: input.workspaceId,
          actorUserId,
          actorKind: "user",
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          traceId: getTraceId(),
          metadata: jsonObjectSchema.parse(input.metadata ?? {}),
        }, client);
      }
    : undefined;
  return new BillingService(repository, provider(), catalog, audit);
}

export async function createCheckoutCommand(input: unknown) {
  const parsed = createCheckoutInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid billing checkout input.", 422);
  const user = await requireUser();
  await assertWorkspaceRole(parsed.data.workspaceId, ["owner"]);
  return (await service(user.id)).createCheckout(parsed.data);
}

export async function getBillingOverviewQuery(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  await requireUser();
  await assertWorkspaceMember(parsed.data);
  return (await service()).getBillingOverview(parsed.data);
}

export async function cancelSubscriptionCommand(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  const user = await requireUser();
  await assertWorkspaceRole(parsed.data, ["owner"]);
  await (await service(user.id)).cancelSubscription(parsed.data);
  return { requested: true };
}

export async function changePlanCommand(input: unknown) {
  const parsed = changePlanInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid billing plan change input.", 422);
  const user = await requireUser();
  await assertWorkspaceRole(parsed.data.workspaceId, ["owner"]);
  await (await service(user.id)).changePlan(parsed.data.workspaceId, parsed.data.plan, parsed.data.interval);
  return { requested: true };
}

export async function receiveDodoWebhook(rawBody: string, headers: WebhookHeaders) {
  const repository = new SupabaseBillingRepository(createSupabaseBillingServiceClient());
  const catalog = getDodoProductCatalog();
  const billing = new BillingService(repository, provider(), catalog);
  return billing.receiveWebhook(rawBody, headers);
}

export async function processBillingWebhookJob(eventId: string, traceId?: string) {
  const repository = new SupabaseBillingRepository(createSupabaseBillingServiceClient());
  const catalog = getDodoProductCatalog();
  return new BillingService(repository, provider(), catalog).processWebhook(eventId, traceId);
}

export async function reconcileBillingSubscriptionCommand(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  const user = await requireUser();
  await assertWorkspaceRole(parsed.data, ["owner"]);
  return (await service(user.id)).reconcileSubscription(parsed.data);
}

export async function reconcileBillingSubscriptionJob(workspaceId: string) {
  return (await service()).reconcileSubscription(workspaceId);
}
