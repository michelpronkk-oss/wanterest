import { requireUser } from "@/server/modules/auth";
import { AppError, type AppErrorCode } from "@/server/lib/errors";
import { getServerEnv } from "@/server/lib/env";
import { getTraceId } from "@/server/lib/request-context";
import { jsonObjectSchema } from "@/server/db/database.helpers";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { createSupabaseBillingServiceClient } from "@/server/providers/supabase/service";
import { recordAuditEvent } from "../observability/audit.service";
import { DodoBillingProvider } from "@/server/providers/billing/dodo/adapter";
import { BillingProviderError, type WebhookHeaders } from "@/server/providers/billing/contracts";
import { SupabaseBillingRepository } from "./billing.repository";
import { BillingService } from "./billing.service";
import { changePlanInputSchema, createCheckoutInputSchema, workspaceIdSchema, type BillingInterval, type BillingPlan } from "./billing.schemas";
import { getDodoProductCatalog, productFor } from "./product-mapping";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

export const BILLING_RETURN_URL = "https://app.wanterest.com/app/settings/billing";
export const CHECKOUT_RETURN_URL = `${BILLING_RETURN_URL}?checkout=success`;

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

/**
 * process.env values can arrive with incidental leading/trailing whitespace (a stray
 * newline from a copy-pasted dashboard secret is the classic case), which is invisible
 * in any UI that shows the value but silently breaks header/URL construction. Every
 * Dodo-bound string is trimmed exactly once here so the rest of the module never has to
 * think about it again.
 */
function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveDodoBaseUrl(env: ReturnType<typeof getServerEnv>): string {
  const override = trimmedOrUndefined(env.DODO_API_BASE_URL);
  if (override) return override;
  return env.DODO_PAYMENTS_ENVIRONMENT === "test_mode" ? "https://test.dodopayments.com" : "https://live.dodopayments.com";
}

/** Safe to log unconditionally: booleans, lengths, and the resolved host, never the key/secret itself. */
function logDodoBillingDiagnostics(env: ReturnType<typeof getServerEnv>, baseUrl: string): void {
  const apiKey = trimmedOrUndefined(env.DODO_PAYMENTS_API_KEY);
  let resolvedApiHost: string | null = null;
  try { resolvedApiHost = new URL(baseUrl).host; } catch { resolvedApiHost = null; }
  console.info("[billing] dodo config diagnostics", {
    environment: env.DODO_PAYMENTS_ENVIRONMENT,
    resolvedApiHost,
    baseUrlOverridden: Boolean(trimmedOrUndefined(env.DODO_API_BASE_URL)),
    apiKeyConfigured: Boolean(apiKey),
    apiKeyLength: apiKey?.length ?? 0,
    productMappingConfigured: {
      proMonthly: Boolean(trimmedOrUndefined(env.DODO_PRODUCT_PRO_MONTHLY)),
      proAnnual: Boolean(trimmedOrUndefined(env.DODO_PRODUCT_PRO_ANNUAL)),
      growthMonthly: Boolean(trimmedOrUndefined(env.DODO_PRODUCT_GROWTH_MONTHLY)),
      growthAnnual: Boolean(trimmedOrUndefined(env.DODO_PRODUCT_GROWTH_ANNUAL)),
    },
  });
}

function provider() {
  const env = getServerEnv();
  const webhookSecret = trimmedOrUndefined(env.DODO_WEBHOOK_SECRET);
  if (!webhookSecret) throw new AppError("INTERNAL_ERROR", "Dodo webhook configuration is missing.");
  return new DodoBillingProvider({
    apiKey: trimmedOrUndefined(env.DODO_PAYMENTS_API_KEY) ?? "webhook-only",
    webhookSecret,
    baseUrl: resolveDodoBaseUrl(env),
    catalog: getDodoProductCatalog(),
  });
}

/**
 * Interactive billing actions (checkout, portal, plan change, cancel) actually call the
 * Dodo API and need a real key, unlike webhook receipt/verification which is HMAC-based
 * and intentionally tolerates a missing key via provider()'s "webhook-only" placeholder.
 * DODO_PAYMENTS_ENVIRONMENT silently defaults to "test_mode" (src/server/lib/env.ts) when
 * unset, which would send a live-mode key/products to the test API and fail every call;
 * refuse to guess and fail fast with a clear config error instead.
 */
function assertDodoBillingConfigured(): void {
  const env = getServerEnv();
  const apiKey = trimmedOrUndefined(env.DODO_PAYMENTS_API_KEY);
  if (!apiKey) {
    throw new AppError("BILLING_CONFIG_ERROR", "Billing is not configured. Support has been notified.", 500, { reason: "missing_api_key" });
  }
  // A real API key is a single contiguous token; internal whitespace (a line break
  // pasted mid-value, a doubled space) always means the value is corrupted, and Dodo's
  // own error message for that case is indistinguishable from a routine 401/403.
  if (/\s/.test(apiKey)) {
    throw new AppError("BILLING_CONFIG_ERROR", "Billing is not configured correctly. Support has been notified.", 500, { reason: "malformed_api_key" });
  }
  if (process.env.DODO_PAYMENTS_ENVIRONMENT === undefined) {
    console.error("[billing] DODO_PAYMENTS_ENVIRONMENT is not set; refusing to silently default to test_mode for a live billing action.");
    throw new AppError("BILLING_CONFIG_ERROR", "Billing environment is not configured. Support has been notified.", 500, { reason: "missing_environment" });
  }
  logDodoBillingDiagnostics(env, resolveDodoBaseUrl(env));
}

/**
 * Read-only diagnostic entry point (see DodoBillingProvider.checkConnectivity): proves
 * whether the configured live/test key authenticates against the resolved API host at
 * all, independent of whether a specific action (like checkout) is authorized. Intended
 * for the `smoke:dodo` script and manual incident diagnosis, never called from a normal
 * request path. Never mutates billing data.
 */
export async function checkDodoConnectivity(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  assertDodoBillingConfigured();
  const billingProvider = provider();
  if (!billingProvider.checkConnectivity) throw new AppError("INTERNAL_ERROR", "The configured billing provider does not support a connectivity check.");
  return billingProvider.checkConnectivity();
}

/**
 * Creates one real (uncompleted, non-billed) Dodo checkout session against the actual
 * `/checkouts` endpoint and product mapping used in production, without ever confirming
 * it or visiting the returned URL — proving the exact request path/shape this app sends
 * is accepted, not just that the key authenticates (see checkDodoConnectivity). Intended
 * only for the `smoke:dodo` script's opt-in checkout check; never called from a normal
 * request path. The synthetic checkoutReference makes any resulting session obviously
 * identifiable (and safely ignorable) in the Dodo dashboard.
 */
export async function checkDodoCheckoutSmoke(): Promise<{ providerCheckoutId: string; checkoutUrl: string }> {
  assertDodoBillingConfigured();
  const catalog = getDodoProductCatalog();
  const mapping = productFor(catalog, "pro", "monthly");
  return provider().createCheckout({
    workspaceId: "00000000-0000-4000-8000-000000000000",
    internalPlan: mapping.internalPlan,
    billingInterval: mapping.billingInterval,
    providerProductId: mapping.providerProductId,
    returnUrl: CHECKOUT_RETURN_URL,
    checkoutReference: `smoke-test:dodo-connectivity:${Date.now()}`,
  });
}

/**
 * Translates provider/config failures into the safe, machine-readable billing error
 * contract instead of letting them fall through to a generic INTERNAL_ERROR with no
 * diagnosable cause. Logs the real provider error (redacted, no secrets/PII) with the
 * business context needed to find it later, tagged by traceId.
 */
function translateBillingError(error: unknown, context: { workspaceId: string; plan?: BillingPlan; interval?: BillingInterval }, defaultCode: AppErrorCode = "CHECKOUT_SESSION_FAILED"): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof BillingProviderError) {
    let environment: string | undefined;
    try { environment = getServerEnv().DODO_PAYMENTS_ENVIRONMENT; } catch { environment = undefined; }
    console.error("[billing] provider request failed", {
      traceId: getTraceId(),
      environment,
      workspaceId: context.workspaceId,
      plan: context.plan ?? null,
      interval: context.interval ?? null,
      providerErrorCode: error.code,
      providerMessage: error.message,
    });
    switch (error.code) {
      case "CONFIGURATION":
      case "UNAUTHORIZED":
        // The API credentials themselves were missing or rejected outright (HTTP 401).
        return new AppError("BILLING_CONFIG_ERROR", "Billing is not configured correctly. Support has been notified.", 500);
      case "FORBIDDEN":
        // HTTP 403: Dodo accepted the credentials but denied the action. Do not
        // describe this as "not configured" — the key is configured and valid; the
        // account/action itself is what's being denied (e.g. live mode not yet
        // activated on the Dodo account, or a live/test product-environment mismatch).
        return new AppError("BILLING_CONFIG_ERROR", "Billing could not be authorized for this account. Support has been notified.", 500);
      case "NOT_FOUND":
        return new AppError(defaultCode, "This plan is not available right now. Support has been notified.", 500);
      case "RATE_LIMITED":
      case "UNAVAILABLE":
        return new AppError("BILLING_PROVIDER_UNAVAILABLE", "The billing provider is temporarily unavailable. Please try again shortly.", 503);
      default:
        return new AppError(defaultCode, defaultCode === "BILLING_PRODUCT_INVALID" ? "This plan is not available right now. Support has been notified." : "The billing request could not be completed. Please try again.", defaultCode === "BILLING_PRODUCT_INVALID" ? 500 : 502);
    }
  }
  console.error("[billing] unexpected billing failure", {
    traceId: getTraceId(),
    workspaceId: context.workspaceId,
    plan: context.plan ?? null,
    interval: context.interval ?? null,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.");
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
  const workspaceId = parsed.data.workspaceId ?? (await getDashboardContext()).workspace?.id;
  if (!workspaceId) throw new AppError("NOT_FOUND", "No active workspace is available for billing.");
  await assertWorkspaceRole(workspaceId, ["owner"]);
  const interval = parsed.data.cadence ?? parsed.data.interval;
  if (!interval) throw new AppError("VALIDATION_ERROR", "Billing cadence is required.", 422);
  try {
    assertDodoBillingConfigured();
    // The browser may request a plan/cadence, but it never chooses a redirect
    // destination. Keep checkout returns on the fixed billing surface.
    return await (await service(user.id)).createCheckout({ workspaceId, plan: parsed.data.plan, interval, returnUrl: CHECKOUT_RETURN_URL, idempotencyKey: parsed.data.idempotencyKey });
  } catch (error) {
    throw translateBillingError(error, { workspaceId, plan: parsed.data.plan, interval }, "BILLING_PRODUCT_INVALID");
  }
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
  try {
    assertDodoBillingConfigured();
    await (await service(user.id)).cancelSubscription(parsed.data);
  } catch (error) {
    throw translateBillingError(error, { workspaceId: parsed.data });
  }
  return { requested: true };
}

export async function changePlanCommand(input: unknown) {
  const parsed = changePlanInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid billing plan change input.", 422);
  const user = await requireUser();
  await assertWorkspaceRole(parsed.data.workspaceId, ["owner"]);
  try {
    assertDodoBillingConfigured();
    await (await service(user.id)).changePlan(parsed.data.workspaceId, parsed.data.plan, parsed.data.interval);
  } catch (error) {
    throw translateBillingError(error, { workspaceId: parsed.data.workspaceId, plan: parsed.data.plan, interval: parsed.data.interval }, "BILLING_PRODUCT_INVALID");
  }
  return { requested: true };
}

export async function createPortalSessionCommand(workspaceId: unknown) {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  await requireUser();
  await assertWorkspaceMember(parsed.data);
  assertDodoBillingConfigured();
  let result: Awaited<ReturnType<BillingService["createPortalSession"]>>;
  try {
    result = await (await service()).createPortalSession(parsed.data, BILLING_RETURN_URL);
  } catch (error) {
    throw translateBillingError(error, { workspaceId: parsed.data });
  }
  return result;
}

export async function receiveDodoWebhook(rawBody: string, headers: WebhookHeaders, traceId?: string) {
  const repository = new SupabaseBillingRepository(createSupabaseBillingServiceClient());
  const catalog = getDodoProductCatalog();
  const billing = new BillingService(repository, provider(), catalog);
  const received = await billing.receiveWebhook(rawBody, headers);
  // The inbox is durable before this bounded normalization step. A failure
  // leaves the event retryable and causes Dodo to redeliver it.
  const processing = await billing.processWebhook(received.eventId, traceId);
  return { ...received, processing };
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
