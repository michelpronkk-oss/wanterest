import { createHash } from "node:crypto";

import { AppError } from "../../lib/errors";
import { jsonObjectSchema } from "../../db/database.helpers";
import type { BillingProvider, VerifiedBillingEvent } from "../../providers/billing/contracts";
import { productFor, type DodoProductCatalog } from "./product-mapping";
import type { BillingInterval, BillingPlan } from "./billing.schemas";
import type { BillingOverview, BillingRepository } from "./billing.repository";
import { resolveInternalPlan } from "../entitlements/plan-capabilities";

export type BillingAuditLogger = (input: {
  workspaceId: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

const noopAudit: BillingAuditLogger = async () => undefined;
const authoritativeSubscriptionEvents = new Set([
  "subscription.active",
  "subscription.updated",
  "subscription.on_hold",
  "subscription.renewed",
  "subscription.plan_changed",
  "subscription.cancelled",
  "subscription.failed",
  "subscription.expired",
]);

function checkoutReference(workspaceId: string, plan: BillingPlan, interval: BillingInterval, idempotencyKey?: string): string {
  const seed = idempotencyKey ?? crypto.randomUUID();
  const digest = createHash("sha256").update(`${workspaceId}:${plan}:${interval}:${seed}`).digest("hex").slice(0, 48);
  return `checkout:${workspaceId}:${digest}`;
}

function eventAction(status: string, previousStatus?: string): string {
  if (status === "past_due") return "billing.subscription_past_due";
  if (status === "canceling") return "billing.cancellation_scheduled";
  if (status === "canceled" || status === "expired") return "billing.subscription_ended";
  if (previousStatus && previousStatus !== status) return "billing.plan_changed";
  return "billing.subscription_activated";
}

export class BillingService {
  private readonly checkoutInflight = new Map<string, Promise<{ checkoutUrl: string; checkoutReference: string }>>();

  constructor(
    private readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
    private readonly catalog: DodoProductCatalog,
    private readonly audit: BillingAuditLogger = noopAudit,
  ) {}

  async createCheckout(input: { workspaceId: string; plan: BillingPlan; interval: BillingInterval; returnUrl?: string; idempotencyKey?: string }): Promise<{ checkoutUrl: string; checkoutReference: string }> {
    const mapping = productFor(this.catalog, input.plan, input.interval);
    const reference = checkoutReference(input.workspaceId, input.plan, input.interval, input.idempotencyKey);
    const active = this.checkoutInflight.get(reference);
    if (active) return active;
    const operation = this.createCheckoutOnce(input, mapping.providerProductId, reference);
    this.checkoutInflight.set(reference, operation);
    try { return await operation; } finally { this.checkoutInflight.delete(reference); }
  }

  private async createCheckoutOnce(input: { workspaceId: string; plan: BillingPlan; interval: BillingInterval; returnUrl?: string }, providerProductId: string, reference: string) {
    const current = await this.repository.getCurrentSubscription(input.workspaceId);
    const currentPlan = resolveInternalPlan(current ? { internalPlan: current.internal_plan, status: current.status } : null);
    if (currentPlan !== "free") {
      throw new AppError("CONFLICT", "This workspace already has a paid subscription. Manage it through the billing portal.", 409, {
        reason: "ACTIVE_SUBSCRIPTION",
        currentPlan,
        requestedPlan: input.plan,
        upgradeTarget: currentPlan === "pro" ? "growth" : null,
      });
    }
    const reservation = await this.repository.reserveCheckout({ workspaceId: input.workspaceId, checkoutReference: reference, plan: input.plan, interval: input.interval });
    if (reservation.checkout_url) return { checkoutUrl: reservation.checkout_url, checkoutReference: reference };
    const checkout = await this.provider.createCheckout({
      workspaceId: input.workspaceId,
      internalPlan: input.plan,
      billingInterval: input.interval,
      providerProductId,
      providerCustomerId: await this.repository.getProviderCustomerId(input.workspaceId),
      returnUrl: input.returnUrl,
      checkoutReference: reference,
    });
    await this.repository.completeCheckout(reservation.id, checkout);
    await this.audit({ workspaceId: input.workspaceId, action: "billing.checkout_initiated", targetType: "billing_checkout_requests", targetId: reservation.id, metadata: { internal_plan: input.plan, billing_interval: input.interval } });
    return { checkoutUrl: checkout.checkoutUrl, checkoutReference: reference };
  }

  async receiveWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<{ eventId: string; duplicate: boolean }> {
    const verified = await this.provider.verifyWebhook(rawBody, headers);
    const result = await this.repository.recordWebhook({ event: verified, payloadHash: createHash("sha256").update(rawBody).digest("hex") });
    return { eventId: result.row.id, duplicate: result.duplicate };
  }

  async processWebhook(eventId: string, traceId?: string): Promise<{ status: "processed" | "ignored" | "already_processed" | "already_processing"; subscription?: Awaited<ReturnType<BillingRepository["getCurrentSubscription"]>> }> {
    const stored = await this.repository.getWebhook(eventId);
    if (!stored) throw new AppError("NOT_FOUND", "Billing webhook was not found.");
    if (stored.processing_status === "processed") return { status: "already_processed" };
    if (!(await this.repository.claimWebhook(eventId))) return { status: "already_processing" };
    try {
      const payload = jsonObjectSchema.safeParse(stored.payload);
      if (!payload.success) throw new AppError("VALIDATION_ERROR", "Stored billing webhook payload is malformed.");
      const verified = this.provider.normalizeStoredWebhook(payload.data, {
        providerEventId: stored.provider_event_id,
        occurredAt: stored.provider_occurred_at ?? stored.received_at,
        eventType: stored.event_type,
      });
      if (verified.diagnostic) {
        await this.repository.markWebhook(eventId, { processingStatus: "ignored", processedAt: new Date().toISOString(), errorCode: verified.diagnostic.code, sanitizedError: verified.diagnostic.message });
        return { status: "ignored" };
      }
      if (!verified.subscription) {
        await this.repository.markWebhook(eventId, { processingStatus: "ignored", processedAt: new Date().toISOString() });
        return { status: "ignored" };
      }
      const metadataWorkspaceId = verified.workspaceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verified.workspaceId)
        ? verified.workspaceId
        : null;
      const customerWorkspaceId = await this.repository.findWorkspaceByProviderCustomerId(verified.subscription.providerCustomerId);
      const subscriptionWorkspaceId = await this.repository.findWorkspaceByProviderSubscriptionId(verified.subscription.providerSubscriptionId);
      const mappedWorkspaceIds = [customerWorkspaceId, subscriptionWorkspaceId].filter((value): value is string => Boolean(value));
      if (metadataWorkspaceId && mappedWorkspaceIds.some((value) => value !== metadataWorkspaceId)) {
        throw new AppError("FORBIDDEN", "Billing workspace association does not match.");
      }
      if (new Set(mappedWorkspaceIds).size > 1) {
        throw new AppError("FORBIDDEN", "Billing provider identifiers map to different workspaces.");
      }
      const workspaceId = metadataWorkspaceId ?? mappedWorkspaceIds[0] ?? null;
      if (!workspaceId) {
        await this.repository.markWebhook(eventId, { processingStatus: "failed", errorCode: "WORKSPACE_UNRESOLVED", sanitizedError: "No trusted workspace association was found." });
        throw new AppError("AUTH_TRANSIENT", "Billing workspace association is not available yet.");
      }
      const authoritative = authoritativeSubscriptionEvents.has(stored.event_type)
        ? await this.provider.getSubscription(verified.subscription.providerSubscriptionId)
        : verified.subscription;
      const applied = await this.applyVerifiedEvent(workspaceId, { ...verified, subscription: authoritative }, traceId);
      await this.repository.markWebhook(eventId, { processingStatus: "processed", processedAt: new Date().toISOString() });
      return { status: "processed", subscription: applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing webhook processing failed.";
      const errorCode = error instanceof AppError && error.code === "AUTH_TRANSIENT"
        ? "WORKSPACE_UNRESOLVED"
        : error instanceof AppError && error.code === "FORBIDDEN"
          ? "WORKSPACE_MISMATCH"
          : "PROCESSING_FAILED";
      await this.repository.markWebhook(eventId, { processingStatus: "failed", errorCode, sanitizedError: message.slice(0, 500) });
      throw error;
    }
  }

  async processVerifiedEvent(workspaceId: string, event: VerifiedBillingEvent, traceId?: string) {
    if (!event.subscription) return { status: "ignored" as const };
    const subscription = await this.applyVerifiedEvent(workspaceId, event, traceId);
    return { status: "processed" as const, subscription };
  }

  private async applyVerifiedEvent(workspaceId: string, event: VerifiedBillingEvent, traceId?: string) {
    const previous = await this.repository.getCurrentSubscription(workspaceId);
    const applied = await this.repository.applySubscription({ workspaceId, subscription: event.subscription!, providerEventId: event.providerEventId, traceId });
    await this.audit({ workspaceId, action: eventAction(event.subscription!.status, previous?.status), targetType: "subscriptions", targetId: applied.id, metadata: { provider_event_id: event.providerEventId, provider_event_type: event.eventType, internal_plan: applied.internal_plan, status: applied.status } });
    return applied;
  }

  async cancelSubscription(workspaceId: string): Promise<void> {
    const subscription = await this.repository.getCurrentSubscription(workspaceId);
    if (!subscription) throw new AppError("NOT_FOUND", "No active subscription was found.");
    await this.provider.cancelSubscription(subscription.provider_subscription_id);
    await this.audit({ workspaceId, action: "billing.cancellation_requested", targetType: "subscriptions", targetId: subscription.id, metadata: { provider_subscription_id: subscription.provider_subscription_id } });
  }

  async createPortalSession(workspaceId: string, returnUrl?: string) {
    const providerCustomerId = await this.repository.getProviderCustomerId(workspaceId);
    if (!providerCustomerId) throw new AppError("NOT_FOUND", "No Dodo billing customer is available for this workspace.");
    const createPortal = this.provider.createPortalSession;
    if (!createPortal) throw new AppError("CONFLICT", "This billing provider does not support a customer portal.");
    return createPortal.call(this.provider, providerCustomerId, returnUrl);
  }

  async changePlan(workspaceId: string, plan: BillingPlan, interval: BillingInterval): Promise<void> {
    const subscription = await this.repository.getCurrentSubscription(workspaceId);
    if (!subscription) throw new AppError("NOT_FOUND", "No active subscription was found.");
    const changer = this.provider.changeSubscription;
    if (!changer) throw new AppError("CONFLICT", "This billing provider requires a replacement checkout to change plans.");
    const mapping = productFor(this.catalog, plan, interval);
    await changer.call(this.provider, { providerSubscriptionId: subscription.provider_subscription_id, providerProductId: mapping.providerProductId, billingInterval: interval });
    await this.audit({ workspaceId, action: "billing.plan_change_requested", targetType: "subscriptions", targetId: subscription.id, metadata: { requested_plan: plan, billing_interval: interval } });
  }

  async reconcileSubscription(workspaceId: string): Promise<Awaited<ReturnType<BillingRepository["getCurrentSubscription"]>>> {
    const current = await this.repository.getCurrentSubscription(workspaceId);
    if (!current) throw new AppError("NOT_FOUND", "No normalized subscription was found.");
    const providerSubscription = await this.provider.getSubscription(current.provider_subscription_id);
    const applied = await this.repository.applySubscription({ workspaceId, subscription: providerSubscription, providerEventId: `reconcile:${current.provider_subscription_id}:${providerSubscription.providerUpdatedAt}` });
    await this.audit({ workspaceId, action: "billing.reconciliation_correction", targetType: "subscriptions", targetId: applied.id, metadata: { provider_updated_at: providerSubscription.providerUpdatedAt, status: providerSubscription.status } });
    return applied;
  }

  async getBillingOverview(workspaceId: string): Promise<BillingOverview> {
    return this.repository.getOverview(workspaceId);
  }
}

export { checkoutReference };
