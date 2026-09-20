import type { JsonObject } from "../../db/database.helpers";
import type { BillingInterval, BillingPlan } from "../../modules/billing/billing.schemas";
import { productFor, type DodoProductCatalog } from "../../modules/billing/product-mapping";
import {
  type BillingProvider,
  type CheckoutRequest,
  type CheckoutResult,
  type ProviderSubscription,
  type VerifiedBillingEvent,
  type WebhookHeaders,
} from "./contracts";
import { DodoBillingProvider, signDodoWebhook } from "./dodo/adapter";

const fixtureSecret = "Zml4dHVyZS1iaWxsaW5nLXNlY3JldA==";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FixtureBillingProvider implements BillingProvider {
  readonly name = "fixture" as const;
  readonly checkouts = new Map<string, CheckoutResult>();
  readonly checkoutInputs = new Map<string, CheckoutRequest>();
  readonly subscriptions = new Map<string, ProviderSubscription>();
  private eventCounter = 0;
  private readonly verifier: DodoBillingProvider;

  constructor(private readonly catalog: DodoProductCatalog, private readonly now: () => Date = () => new Date()) {
    this.verifier = new DodoBillingProvider({
      apiKey: "fixture",
      webhookSecret: fixtureSecret,
      baseUrl: "https://fixture.invalid",
      catalog,
      clock: now,
    });
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const existing = this.checkouts.get(input.checkoutReference);
    if (existing) return existing;
    const result = {
      providerCheckoutId: `checkout_${input.checkoutReference}`,
      checkoutUrl: `https://checkout.fixture.test/${encodeURIComponent(input.checkoutReference)}`,
    };
    this.checkoutInputs.set(input.checkoutReference, input);
    this.checkouts.set(input.checkoutReference, result);
    return result;
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const subscription = this.subscriptions.get(providerSubscriptionId);
    if (!subscription) throw new Error("fixture_subscription_not_found");
    return clone(subscription);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null> {
    const current = await this.getSubscription(providerSubscriptionId);
    const updated = { ...current, status: "canceling" as const, cancelAtPeriodEnd: true, providerUpdatedAt: this.now().toISOString() };
    this.subscriptions.set(providerSubscriptionId, updated);
    return clone(updated);
  }

  async changeSubscription(input: { providerSubscriptionId: string; providerProductId: string; billingInterval: BillingInterval }): Promise<ProviderSubscription> {
    const current = await this.getSubscription(input.providerSubscriptionId);
    const mapping = Object.values(this.catalog).find((candidate) => candidate.providerProductId === input.providerProductId);
    if (!mapping) throw new Error("fixture_product_not_found");
    const updated = { ...current, providerProductId: input.providerProductId, internalPlan: mapping.internalPlan, billingInterval: input.billingInterval, providerUpdatedAt: this.now().toISOString() };
    this.subscriptions.set(input.providerSubscriptionId, updated);
    return clone(updated);
  }

  async verifyWebhook(rawBody: string, headers: WebhookHeaders, now = this.now()): Promise<VerifiedBillingEvent> {
    return this.verifier.verifyWebhook(rawBody, headers, now).then((event) => ({ ...event, provider: "fixture" }));
  }

  normalizeStoredWebhook(payload: JsonObject, context: { providerEventId: string; occurredAt: string; eventType: string }): VerifiedBillingEvent {
    const event = this.verifier.normalizeStoredWebhook(payload, context);
    return { ...event, provider: "fixture" };
  }

  seedSubscription(input: {
    providerSubscriptionId: string;
    providerCustomerId: string;
    internalPlan: BillingPlan;
    billingInterval: BillingInterval;
    status?: ProviderSubscription["status"];
    currentPeriodEnd?: string;
  }): ProviderSubscription {
    const mapping = productFor(this.catalog, input.internalPlan, input.billingInterval);
    const subscription: ProviderSubscription = {
      providerSubscriptionId: input.providerSubscriptionId,
      providerCustomerId: input.providerCustomerId,
      customerEmail: "fixture@example.test",
      providerProductId: mapping.providerProductId,
      internalPlan: input.internalPlan,
      billingInterval: input.billingInterval,
      status: input.status ?? "active",
      currentPeriodStart: this.now().toISOString(),
      currentPeriodEnd: input.currentPeriodEnd ?? new Date(this.now().getTime() + 30 * 86_400_000).toISOString(),
      cancelAtPeriodEnd: input.status === "canceling",
      providerUpdatedAt: this.now().toISOString(),
    };
    this.subscriptions.set(subscription.providerSubscriptionId, subscription);
    return clone(subscription);
  }

  async emit(
    providerSubscriptionId: string,
    event: "active" | "renewed" | "canceling" | "canceled" | "expired" | "past_due" | "upgrade" | "downgrade",
    overrides: Partial<ProviderSubscription> = {},
  ): Promise<VerifiedBillingEvent> {
    const current = await this.getSubscription(providerSubscriptionId);
    const status = event === "canceling" ? "canceling" : event === "canceled" ? "canceled" : event === "expired" ? "expired" : event === "past_due" ? "past_due" : "active";
    const updated: ProviderSubscription = {
      ...current,
      ...overrides,
      status,
      cancelAtPeriodEnd: event === "canceling" || overrides.cancelAtPeriodEnd === true,
      providerUpdatedAt: overrides.providerUpdatedAt ?? this.now().toISOString(),
    };
    this.subscriptions.set(providerSubscriptionId, updated);
    const eventId = `fixture_event_${++this.eventCounter}`;
    const payload = {
      type: event === "past_due" ? "payment.failed" : `subscription.${event}`,
      created_at: updated.providerUpdatedAt,
      data: {
        id: updated.providerSubscriptionId,
        subscription_id: updated.providerSubscriptionId,
        customer_id: updated.providerCustomerId,
        customer: { customer_id: updated.providerCustomerId, email: updated.customerEmail },
        product_id: updated.providerProductId,
        status: updated.status,
        current_period_start: updated.currentPeriodStart,
        current_period_end: updated.currentPeriodEnd,
        cancel_at_period_end: updated.cancelAtPeriodEnd,
        updated_at: updated.providerUpdatedAt,
      },
    } as JsonObject;
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(new Date(updated.providerUpdatedAt).getTime() / 1_000);
    return this.verifyWebhook(rawBody, {
      "webhook-id": eventId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signDodoWebhook(rawBody, eventId, timestamp, fixtureSecret),
    }, new Date(timestamp * 1_000));
  }
}

export { fixtureSecret };
