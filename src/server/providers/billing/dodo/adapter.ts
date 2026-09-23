import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { JsonObject } from "../../../db/database.helpers";
import type { BillingInterval } from "../../../modules/billing/billing.schemas";
import { findProductMapping, type DodoProductCatalog } from "../../../modules/billing/product-mapping";
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutRequest,
  type CheckoutResult,
  type ProviderSubscription,
  type VerifiedBillingEvent,
  type WebhookHeaders,
} from "../contracts";

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
  baseUrl: string;
  catalog: DodoProductCatalog;
  fetcher?: FetchLike;
  clock?: () => Date;
  replayWindowSeconds?: number;
};

export class DodoBillingProvider implements BillingProvider {
  readonly name = "dodo" as const;
  private readonly fetcher: FetchLike;
  private readonly clock: () => Date;

  constructor(private readonly config: DodoBillingConfig) {
    this.fetcher = config.fetcher ?? fetch;
    this.clock = config.clock ?? (() => new Date());
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    // Dodo's hosted checkout-creation endpoint is POST /checkouts (a prior "/checkout-sessions"
    // path does not exist on the live API and returned 403, not 404, because it never reached
    // real request handling). The request body contract (product_cart/customer/return_url/
    // metadata) is unchanged between the two — only the path was wrong.
    const response = await this.request("/checkouts", {
      method: "POST",
      headers: { "Idempotency-Key": input.checkoutReference },
      body: {
        product_cart: [{ product_id: input.providerProductId, quantity: 1 }],
        ...(input.providerCustomerId ? { customer: { customer_id: input.providerCustomerId } } : {}),
        return_url: input.returnUrl,
        metadata: {
          workspace_id: input.workspaceId,
          workspaceId: input.workspaceId,
          internal_plan: input.internalPlan,
          billing_interval: input.billingInterval,
          checkout_reference: input.checkoutReference,
        },
      },
    });
    // /checkouts responds with { session_id, checkout_url, ... } — not the { session_id |
    // checkout_id | id } / { checkout_url | url } guesswork the old code carried over
    // unverified from the wrong endpoint. checkout_url is nullable in Dodo's own schema
    // (e.g. when a payment is confirmed immediately), so this can legitimately fail.
    const record = asRecord(response);
    const checkoutUrl = stringAt(record, "checkout_url");
    const checkoutId = stringAt(record, "session_id");
    if (!checkoutUrl || !checkoutId) throw new BillingProviderError("PROVIDER_ERROR", "Dodo did not return a checkout URL.");
    return { providerCheckoutId: checkoutId, checkoutUrl };
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
      await this.request("/products?page_size=1", { method: "GET" });
      return { ok: true };
    } catch (error) {
      if (error instanceof BillingProviderError) return { ok: false, code: error.code, message: error.message };
      throw error;
    }
  }

  async createPortalSession(providerCustomerId: string, returnUrl?: string) {
    const query = new URLSearchParams();
    if (returnUrl) query.set("return_url", returnUrl);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const response = await this.request(`/customers/${encodeURIComponent(providerCustomerId)}/customer-portal/session${suffix}`, { method: "POST" });
    const link = stringAt(asRecord(response), "link", "url", "portal_url");
    if (!link) throw new BillingProviderError("PROVIDER_ERROR", "Dodo did not return a customer portal link.");
    return { portalUrl: link };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const response = await this.request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { method: "GET" });
    return this.normalizeSubscription({
      type: "subscription.updated",
      data: jsonObject(response),
      created_at: this.clock().toISOString(),
    }, providerSubscriptionId);
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null> {
    const response = await this.request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
      method: "PATCH",
      body: { cancel_at_next_billing_date: true },
    });
    return this.normalizeSubscription({ type: "subscription.updated", data: jsonObject(response), created_at: this.clock().toISOString() }, providerSubscriptionId);
  }

  async changeSubscription(input: { providerSubscriptionId: string; providerProductId: string; billingInterval: BillingInterval }): Promise<ProviderSubscription> {
    const response = await this.request(`/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`, {
      method: "PATCH",
      body: { product_id: input.providerProductId, billing_interval: input.billingInterval },
    });
    return this.normalizeSubscription({ type: "subscription.updated", data: jsonObject(response), created_at: this.clock().toISOString() }, input.providerSubscriptionId);
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
      providerUpdatedAt: updatedAt,
    };
  }

  private async request(path: string, input: { method: string; headers?: Record<string, string>; body?: unknown }): Promise<unknown> {
    if (!this.config.apiKey) throw new BillingProviderError("CONFIGURATION", "Dodo API key is not configured.");
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
        method: input.method,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", ...input.headers },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
    } catch {
      throw new BillingProviderError("UNAVAILABLE", "Dodo is temporarily unavailable.", true);
    }
    const text = await response.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!response.ok) {
      const record = asRecord(body);
      const providerCode = stringAt(record, "code", "error_code", "type");
      const providerMessage = stringAt(record, "message", "error");
      // Safe: only the provider's own short code/message is logged, never the
      // Authorization header, request body, or payment data.
      console.error("[dodo] request failed", { path, status: response.status, providerCode, providerMessage: providerMessage?.slice(0, 300) });
      // 401 means the credentials were not accepted at all (bad/missing key) — a genuine
      // config error. 403 means the credentials WERE accepted but this specific account/key
      // is not permitted to perform the action (e.g. live mode not activated, product/key
      // environment mismatch, IP allowlist). Collapsing these two hid exactly the signal
      // needed to rule out "the key is wrong" once the key is already confirmed valid.
      if (response.status === 401) throw new BillingProviderError("UNAUTHORIZED", "Dodo did not accept the configured API credentials.");
      if (response.status === 403) throw new BillingProviderError("FORBIDDEN", "Dodo authenticated the request but denied this action.");
      if (response.status === 404) throw new BillingProviderError("NOT_FOUND", "Dodo could not find the referenced resource.");
      if (response.status === 422) throw new BillingProviderError("INVALID_REQUEST", "Dodo rejected the request payload.");
      if (response.status === 429) throw new BillingProviderError("RATE_LIMITED", "Dodo rate limited the request.", true);
      if (response.status >= 500) throw new BillingProviderError("UNAVAILABLE", "Dodo is temporarily unavailable.", true);
      throw new BillingProviderError("PROVIDER_ERROR", "Dodo rejected the billing request.");
    }
    return body;
  }
}

export function signDodoWebhook(rawBody: string, webhookId: string, timestampSeconds: number, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key.length > 0 ? key : Buffer.from(secret)).update(`${webhookId}.${timestampSeconds}.${rawBody}`).digest("base64");
  return `v1,${signature}`;
}
