import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";
import { APIError, APIConnectionError, DodoPayments } from "dodopayments";

import type { JsonObject } from "../../../db/database.helpers";
import type { BillingInterval } from "../../../modules/billing/billing.schemas";
import { findProductMapping, type DodoProductCatalog } from "../../../modules/billing/product-mapping";
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutRequest,
  type CheckoutResult,
  type ProviderDiscountCreateRequest,
  type ProviderDiscountSnapshot,
  type ProviderSubscription,
  type VerifiedBillingEvent,
  type WebhookHeaders,
} from "../contracts";
import { createDodoClient, type DodoEnvironment } from "./client";

const dodoPayloadSchema = z.object({
  type: z.string().trim().min(1).optional(),
  event_type: z.string().trim().min(1).optional(),
  created_at: z.string().optional(),
  timestamp: z.string().optional(),
  data: z.unknown().optional(),
}).passthrough();

type FetchLike = typeof fetch;

// These are the subscription/payment event names currently documented by Dodo's
// webhook API. Other signed events are retained in the inbox but do not mutate
// Wanterest billing state.
const subscriptionEventTypes = new Set([
  "subscription.active",
  "subscription.updated",
  "subscription.on_hold",
  "subscription.renewed",
  "subscription.plan_changed",
  "subscription.cancelled",
  "subscription.failed",
  "subscription.expired",
]);
const paymentEventTypes = new Set(["payment.succeeded", "payment.failed", "payment.processing", "payment.cancelled"]);

function header(headers: WebhookHeaders, name: string): string | undefined {
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry?.[1];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringAt(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function booleanAt(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  return undefined;
}

function jsonObject(value: unknown): JsonObject {
  const parsed = z.record(z.string(), z.json()).safeParse(value);
  if (!parsed.success) throw new BillingProviderError("INVALID_REQUEST", "Dodo webhook payload is not JSON-safe.");
  return parsed.data;
}

function dateString(value: unknown, fallback: string): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1_000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function normalizeStatus(eventType: string, data: Record<string, unknown>): ProviderSubscription["status"] {
  const event = eventType.toLowerCase();
  const raw = (stringAt(data, "status", "subscription_status") ?? "").toLowerCase();
  // A cancellation scheduled for the next billing date keeps the current
  // paid entitlement. The terminal transition is represented by expiration.
  if (booleanAt(data, "cancel_at_period_end", "cancel_at_next_billing_date") === true) return "canceling";
  if (event === "subscription.on_hold" || event === "payment.failed" || event.includes("payment_failed") || raw === "past_due" || raw === "unpaid" || raw === "on_hold") return "past_due";
  if (event === "subscription.failed" || raw === "failed") return "incomplete";
  if (event.includes("expired") || raw === "expired") return "expired";
  if (event.includes("canceling") || event.includes("cancellation.scheduled") || event.includes("cancel_scheduled") || raw === "canceling" || raw === "canceled_pending_end") return "canceling";
  if (event === "subscription.cancelled" || (event.includes("cancel") && !event.includes("cancellation.scheduled") && !event.includes("cancelled_at_period_end"))) return "canceled";
  if (raw === "canceled" || raw === "cancelled") return "canceled";
  if (raw === "trialing" || raw === "trial") return "trialing";
  if (raw === "incomplete" || raw === "pending") return "incomplete";
  return "active";
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/card|payment_method|pan|cvv|cvc|secret|token/i.test(key)) continue;
      output[key] = redact(child);
    }
    return output;
  }
  return value;
}

export type DodoBillingConfig = {
  apiKey: string;
  webhookSecret: string;
  baseUrl?: string;
  environment?: DodoEnvironment;
  catalog: DodoProductCatalog;
  fetcher?: FetchLike;
  clock?: () => Date;
  replayWindowSeconds?: number;
};

export class DodoBillingProvider implements BillingProvider {
  readonly name = "dodo" as const;
  private readonly clock: () => Date;
  private readonly client: DodoPayments;

  constructor(private readonly config: DodoBillingConfig) {
    this.clock = config.clock ?? (() => new Date());
    this.client = createDodoClient({
      apiKey: config.apiKey,
      environment: config.environment,
      baseUrl: config.baseUrl,
      fetcher: config.fetcher,
    });
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const response = await this.call("/checkouts", () => this.client.checkoutSessions.create({
      product_cart: [{ product_id: input.providerProductId, quantity: 1 }],
      ...(input.providerCustomerId ? { customer: { customer_id: input.providerCustomerId } } : {}),
      ...(input.discountCodes?.length ? { discount_codes: input.discountCodes, feature_flags: { allow_discount_code: false } } : {}),
      return_url: input.returnUrl,
      metadata: {
        workspace_id: input.workspaceId,
        workspaceId: input.workspaceId,
        internal_plan: input.internalPlan,
        billing_interval: input.billingInterval,
        checkout_reference: input.checkoutReference,
      },
    }, { headers: { "Idempotency-Key": input.checkoutReference } }));
    if (!response.checkout_url) throw new BillingProviderError("PROVIDER_ERROR", "Dodo did not return a checkout URL.");
    return { providerCheckoutId: response.session_id, checkoutUrl: response.checkout_url };
  }

  /**
   * Read-only, non-mutating probe of whether the configured key authenticates against
   * the resolved base URL at all, independent of checkout-specific authorization. Lists
   * one product; never creates, updates, or deletes anything. Used to distinguish "the
   * key/host itself is broken" (this also fails) from "checkout specifically is denied"
   * (this succeeds, checkout still 403s) without ever touching billing state.
   */
  async checkConnectivity(): Promise<{ ok: true } | { ok: false; code: BillingProviderError["code"]; message: string }> {
    try {
      await this.call("/products", () => this.client.products.list({ page_size: 1 }));
      return { ok: true };
    } catch (error) {
      if (error instanceof BillingProviderError) return { ok: false, code: error.code, message: error.message };
      throw error;
    }
  }

  async createPortalSession(providerCustomerId: string, returnUrl?: string) {
    const response = await this.call("/customers/customer-portal/session", () => this.client.customers.customerPortal.create(providerCustomerId, returnUrl ? { return_url: returnUrl } : undefined));
    const link = stringAt(asRecord(response), "link", "url", "portal_url");
    if (!link) throw new BillingProviderError("PROVIDER_ERROR", "Dodo did not return a customer portal link.");
    return { portalUrl: link };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const response = await this.call(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, () => this.client.subscriptions.retrieve(providerSubscriptionId));
    return this.normalizeSubscription({
      type: "subscription.updated",
      data: jsonObject(response),
      created_at: this.clock().toISOString(),
    }, providerSubscriptionId);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null> {
    const response = await this.call(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, () => this.client.subscriptions.update(providerSubscriptionId, { cancel_at_next_billing_date: true }));
    return this.normalizeSubscription({ type: "subscription.updated", data: jsonObject(response), created_at: this.clock().toISOString() }, providerSubscriptionId);
  }

  async changeSubscription(input: { providerSubscriptionId: string; providerProductId: string; billingInterval: BillingInterval; discountCodes?: string[] }): Promise<ProviderSubscription> {
    await this.call(`/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}/change-plan`, () => this.client.subscriptions.changePlan(input.providerSubscriptionId, {
      product_id: input.providerProductId,
      quantity: 1,
      proration_billing_mode: "do_not_bill",
      ...(input.discountCodes ? { discount_codes: input.discountCodes } : {}),
      effective_at: "immediately",
    }, { headers: { "Idempotency-Key": `plan-change:${input.providerSubscriptionId}:${input.providerProductId}:${input.billingInterval}` } }));
    return this.getSubscription(input.providerSubscriptionId);
  }

  async createDiscount(input: ProviderDiscountCreateRequest): Promise<ProviderDiscountSnapshot> {
    const response = await this.call("/discounts", () => this.client.discounts.create({
      amount: input.amountBasisPoints,
      type: "percentage",
      restricted_to: input.productIds,
      subscription_cycles: input.subscriptionCycles,
      expires_at: input.expiresAt ?? null,
      preserve_on_plan_change: false,
      metadata: input.metadata,
    }, { headers: { "Idempotency-Key": input.idempotencyKey } }));
    return this.normalizeDiscount(response);
  }

  async getDiscount(providerDiscountId: string): Promise<ProviderDiscountSnapshot> {
    return this.normalizeDiscount(await this.call(`/discounts/${encodeURIComponent(providerDiscountId)}`, () => this.client.discounts.retrieve(providerDiscountId)));
  }

  async deleteDiscount(providerDiscountId: string): Promise<void> {
    await this.call(`/discounts/${encodeURIComponent(providerDiscountId)}`, () => this.client.discounts.delete(providerDiscountId));
  }

  async verifyWebhook(rawBody: string, headers: WebhookHeaders, now = this.clock()): Promise<VerifiedBillingEvent> {
    const webhookId = header(headers, "webhook-id");
    const timestamp = header(headers, "webhook-timestamp");
    const signatureHeader = header(headers, "webhook-signature");
    if (!webhookId || !timestamp || !signatureHeader) {
      throw new BillingProviderError("UNAUTHORIZED", "Dodo webhook signature headers are missing.");
    }
    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) || Math.abs(now.getTime() / 1_000 - timestampSeconds) > (this.config.replayWindowSeconds ?? 300)) {
      throw new BillingProviderError("UNAUTHORIZED", "Dodo webhook timestamp is outside the replay window.");
    }
    const signed = `${webhookId}.${timestamp}.${rawBody}`;
    const secret = this.config.webhookSecret.replace(/^whsec_/, "");
    const secretBytes = Buffer.from(secret, "base64");
    const key = secretBytes.length > 0 ? secretBytes : Buffer.from(this.config.webhookSecret);
    const expected = createHmac("sha256", key).update(signed).digest("base64");
    const valid = signatureHeader.split(" ").some((candidate) => {
      const [version, value] = candidate.split(",", 2);
      if (version !== "v1" || !value) return false;
      const left = Buffer.from(value);
      const right = Buffer.from(expected);
      return left.length === right.length && timingSafeEqual(left, right);
    });
    if (!valid) throw new BillingProviderError("UNAUTHORIZED", "Dodo webhook signature is invalid.");

    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { throw new BillingProviderError("INVALID_REQUEST", "Dodo webhook payload is not valid JSON."); }
    const payload = dodoPayloadSchema.safeParse(parsed);
    if (!payload.success) throw new BillingProviderError("INVALID_REQUEST", "Dodo webhook payload is malformed.");
    const eventType = payload.data.type ?? payload.data.event_type;
    if (!eventType) throw new BillingProviderError("INVALID_REQUEST", "Dodo webhook event type is missing.");
    const occurredAt = dateString(payload.data.created_at ?? payload.data.timestamp, now.toISOString());
    const sanitized = jsonObject(redact(parsed));
    return this.normalizeStoredWebhook(sanitized, { providerEventId: webhookId, occurredAt, eventType });
  }

  normalizeStoredWebhook(payload: JsonObject, context: { providerEventId: string; occurredAt: string; eventType: string }): VerifiedBillingEvent {
    let subscription: ProviderSubscription | undefined;
    let diagnostic: VerifiedBillingEvent["diagnostic"];
    if (subscriptionEventTypes.has(context.eventType) || paymentEventTypes.has(context.eventType)) {
      try {
        subscription = this.normalizeSubscription(payload, undefined, context.occurredAt, context.eventType);
      } catch (error) {
        // An unmapped product is a safe, durable diagnostic. A structurally
        // malformed subscription event is still rejected before it enters the
        // inbox; payment-only events may be acknowledged without a subscription.
        if (error instanceof BillingProviderError && error.message.includes("not mapped")) {
          diagnostic = { code: "UNKNOWN_PRODUCT", message: "Dodo product is not mapped to an internal Wanterest plan." };
        } else if (paymentEventTypes.has(context.eventType)) {
          subscription = undefined;
        } else {
          throw error;
        }
      }
    }
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const metadata = { ...asRecord(root.metadata), ...asRecord(data.metadata) };
    const workspaceId = stringAt(metadata, "workspace_id", "workspaceId");
    return {
      provider: "dodo",
      providerEventId: context.providerEventId,
      eventType: context.eventType,
      occurredAt: context.occurredAt,
      payload,
      ...(workspaceId ? { workspaceId } : {}),
      ...(subscription ? { subscription } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
  }

  private normalizeSubscription(payload: JsonObject, fallbackSubscriptionId?: string, fallbackOccurredAt?: string, fallbackEventType?: string): ProviderSubscription {
    const root = asRecord(payload);
    const eventType = stringAt(root, "type", "event_type") ?? fallbackEventType ?? "subscription.updated";
    const data = asRecord(root.data ?? root);
    const customer = asRecord(data.customer);
    const subscriptionId = stringAt(data, "subscription_id", "id") ?? fallbackSubscriptionId;
    const customerId = stringAt(customer, "customer_id", "id") ?? stringAt(data, "customer_id");
    const providerProductId = stringAt(data, "product_id", "provider_product_id") ?? stringAt(asRecord(data.product), "id");
    if (!subscriptionId || !customerId || !providerProductId) {
      throw new BillingProviderError("INVALID_REQUEST", "Dodo subscription payload is missing required identifiers.");
    }
    const mapping = findProductMapping(this.config.catalog, providerProductId);
    if (!mapping) throw new BillingProviderError("INVALID_REQUEST", "Dodo product is not mapped to an internal Wanterest plan.");
    const occurredAt = fallbackOccurredAt ?? dateString(root.created_at ?? root.timestamp, this.clock().toISOString());
    const updatedAt = dateString(data.updated_at ?? root.created_at ?? root.timestamp, occurredAt);
    const status = normalizeStatus(eventType, data);
    return {
      providerSubscriptionId: subscriptionId,
      providerCustomerId: customerId,
      customerEmail: stringAt(customer, "email") ?? stringAt(data, "customer_email") ?? null,
      providerProductId,
      providerPriceReference: stringAt(data, "price_id", "price_reference") ?? null,
      internalPlan: mapping.internalPlan,
      billingInterval: mapping.billingInterval,
      status,
      currentPeriodStart: data.current_period_start ? dateString(data.current_period_start, occurredAt) : null,
      currentPeriodEnd: data.current_period_end || data.next_billing_date ? dateString(data.current_period_end ?? data.next_billing_date, occurredAt) : null,
      cancelAtPeriodEnd: booleanAt(data, "cancel_at_period_end", "cancel_at_next_billing_date") ?? status === "canceling",
      canceledAt: data.canceled_at ? dateString(data.canceled_at, occurredAt) : null,
      endedAt: data.ended_at ? dateString(data.ended_at, occurredAt) : (status === "canceled" || status === "expired" ? updatedAt : null),
      paymentFailureState: status === "past_due" ? (stringAt(data, "payment_failure_state", "failure_code") ?? "provider_payment_failed") : null,
      providerDiscounts: Array.isArray(data.discounts) ? data.discounts.map((discount) => this.normalizeDiscount(discount as Record<string, unknown>)) : [],
      providerUpdatedAt: updatedAt,
    };
  }

  private normalizeDiscount(value: unknown): ProviderDiscountSnapshot {
    const record = asRecord(value);
    const id = stringAt(record, "discount_id", "id");
    const code = stringAt(record, "code");
    const type = stringAt(record, "type");
    const amount = record.amount;
    if (!id || !code || type !== "percentage" || typeof amount !== "number") {
      throw new BillingProviderError("INVALID_REQUEST", "Dodo discount payload is malformed.");
    }
    const restrictedTo = Array.isArray(record.restricted_to) ? record.restricted_to.filter((item): item is string => typeof item === "string") : [];
    const metadata = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).safeParse(record.metadata ?? {});
    if (!metadata.success) throw new BillingProviderError("INVALID_REQUEST", "Dodo discount metadata is malformed.");
    const customerEligibility = stringAt(record, "customer_eligibility");
    return {
      providerDiscountId: id,
      code,
      amountBasisPoints: amount,
      restrictedTo,
      ...(customerEligibility === "any" || customerEligibility === "first_time" || customerEligibility === "existing" || customerEligibility === "specific" ? { customerEligibility } : {}),
      expiresAt: typeof record.expires_at === "string" ? dateString(record.expires_at, record.expires_at) : null,
      subscriptionCycles: typeof record.subscription_cycles === "number" ? record.subscription_cycles : null,
      cyclesRemaining: typeof record.cycles_remaining === "number" ? record.cycles_remaining : (typeof record.discount_cycles_remaining === "number" ? record.discount_cycles_remaining : null),
      preserveOnPlanChange: record.preserve_on_plan_change === true,
      usageLimit: typeof record.usage_limit === "number" ? record.usage_limit : null,
      metadata: metadata.data,
    };
  }

  private async call<T>(path: string, operation: () => Promise<T>): Promise<T> {
    if (!this.config.apiKey) throw new BillingProviderError("CONFIGURATION", "Dodo API key is not configured.");
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      if (error instanceof APIConnectionError) throw new BillingProviderError("UNAVAILABLE", "Dodo is temporarily unavailable.", true);
      if (error instanceof APIError) {
        const status = error.status;
        const providerRecord = asRecord(error.error);
        const providerCode = stringAt(providerRecord, "code", "error_code", "type");
        const providerMessage = stringAt(providerRecord, "message", "error");
        console.error("[dodo] request failed", { path, status, providerCode, providerMessage: providerMessage?.slice(0, 300) });
        if (status === 401) throw new BillingProviderError("UNAUTHORIZED", "Dodo did not accept the configured API credentials.");
        if (status === 403) throw new BillingProviderError("FORBIDDEN", "Dodo authenticated the request but denied this action.");
        if (status === 404) throw new BillingProviderError("NOT_FOUND", "Dodo could not find the referenced resource.");
        if (status === 422) throw new BillingProviderError("INVALID_REQUEST", "Dodo rejected the request payload.");
        if (status === 429) throw new BillingProviderError("RATE_LIMITED", "Dodo rate limited the request.", true);
        if (typeof status === "number" && status >= 500) throw new BillingProviderError("UNAVAILABLE", "Dodo is temporarily unavailable.", true);
        throw new BillingProviderError("PROVIDER_ERROR", "Dodo rejected the billing request.");
      }
      throw new BillingProviderError("PROVIDER_ERROR", error instanceof Error ? error.message : "Dodo billing request failed.");
    }
  }
}

export function signDodoWebhook(rawBody: string, webhookId: string, timestampSeconds: number, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key.length > 0 ? key : Buffer.from(secret)).update(`${webhookId}.${timestampSeconds}.${rawBody}`).digest("base64");
  return `v1,${signature}`;
}
