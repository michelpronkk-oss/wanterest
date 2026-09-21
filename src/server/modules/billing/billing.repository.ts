import type { SupabaseClient as SupabaseJsClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types";
import type { Json } from "../../db/database.helpers";
import type {
  BillingCheckoutRequestRow,
  BillingCustomerRow,
  BillingWebhookEventRow,
  SubscriptionRow,
} from "../../db/database.helpers";
import { AppError } from "../../lib/errors";
import type { BillingInterval, BillingPlan } from "./billing.schemas";
import type { ProviderSubscription, VerifiedBillingEvent } from "../../providers/billing/contracts";
import { ensureMonitoringSchedulesForActiveProducts } from "../monitoring/monitoring.schedule";

export type EffectiveEntitlement = {
  capabilityKey: string;
  valueType: "boolean" | "integer" | "decimal" | "enum";
  value: boolean | number | string;
};

export type BillingSubscriptionView = Pick<SubscriptionRow, "id" | "workspace_id" | "internal_plan" | "billing_interval" | "status" | "current_period_start" | "current_period_end" | "cancel_at_period_end" | "canceled_at" | "ended_at" | "payment_failure_state" | "created_at" | "updated_at">;

export type BillingOverview = {
  subscription: BillingSubscriptionView | null;
  effectivePlan: "free" | "pro" | "growth";
  entitlements: EffectiveEntitlement[];
  usage: Array<{ usageType: string; amount: number }>;
};

export type CheckoutReservation = BillingCheckoutRequestRow;

export type BillingRepository = {
  reserveCheckout(input: {
    workspaceId: string;
    checkoutReference: string;
    plan: BillingPlan;
    interval: BillingInterval;
  }): Promise<CheckoutReservation>;
  completeCheckout(id: string, result: { providerCheckoutId: string; checkoutUrl: string }): Promise<CheckoutReservation>;
  recordWebhook(input: {
    event: VerifiedBillingEvent;
    payloadHash: string;
  }): Promise<{ row: BillingWebhookEventRow; duplicate: boolean }>;
  getWebhook(eventId: string): Promise<BillingWebhookEventRow | null>;
  markWebhook(eventId: string, update: { processingStatus: BillingWebhookEventRow["processing_status"]; processedAt?: string; errorCode?: string; sanitizedError?: string }): Promise<void>;
  applySubscription(input: {
    workspaceId: string;
    subscription: ProviderSubscription;
    providerEventId: string;
    actorUserId?: string | null;
    traceId?: string | null;
  }): Promise<SubscriptionRow>;
  getCurrentSubscription(workspaceId: string): Promise<SubscriptionRow | null>;
  findWorkspaceByProviderSubscriptionId(providerSubscriptionId: string): Promise<string | null>;
  getOverview(workspaceId: string): Promise<BillingOverview>;
};

export function entitlementValue(valueType: EffectiveEntitlement["valueType"], value: Json): EffectiveEntitlement["value"] {
  if (valueType === "boolean" && typeof value === "boolean") return value;
  if ((valueType === "integer" || valueType === "decimal") && typeof value === "number") return value;
  if (valueType === "enum" && typeof value === "string") return value;
  throw new AppError("INTERNAL_ERROR", "Stored entitlement value is malformed.");
}

function createId(): string {
  return crypto.randomUUID();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function now(): string {
  return new Date().toISOString();
}

function publicSubscription(row: SubscriptionRow | null): BillingSubscriptionView | null {
  if (!row) return null;
  const { id, workspace_id, internal_plan, billing_interval, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at, payment_failure_state, created_at, updated_at } = row;
  return { id, workspace_id, internal_plan, billing_interval, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at, payment_failure_state, created_at, updated_at };
}

// Test/fixture repository only. Production entitlement reads come from the
// normalized workspace_entitlements rows in Supabase.
const catalogValues: Record<BillingPlan | "free", EffectiveEntitlement[]> = {
  free: [
    ["products_max", "integer", 1], ["signals_monthly", "integer", 5], ["scan_frequency", "enum", "manual"],
    ["demand_map", "enum", "preview"], ["demand_gap", "enum", "preview"], ["demand_drift_days", "integer", 0],
    ["actions_enabled", "boolean", false], ["experiments_max", "integer", 0], ["exports", "boolean", false], ["team_members", "integer", 1],
    ["monitoring_enabled", "boolean", false], ["intelligence_cycles_per_day", "integer", 0], ["intelligence_cycle_interval_minutes", "integer", 0], ["deep_refreshes_per_week", "integer", 0], ["manual_refresh_cooldown_minutes", "integer", 1440], ["digest_enabled", "boolean", false], ["priority_alerts_enabled", "boolean", false],
  ].map(([capabilityKey, valueType, value]) => ({ capabilityKey: capabilityKey as string, valueType: valueType as EffectiveEntitlement["valueType"], value: value as EffectiveEntitlement["value"] })),
  pro: [
    ["products_max", "integer", 3], ["signals_monthly", "integer", 500], ["scan_frequency", "enum", "daily"],
    ["demand_map", "enum", "full"], ["demand_gap", "enum", "full"], ["demand_drift_days", "integer", 30],
    ["actions_enabled", "boolean", true], ["experiments_max", "integer", 2], ["exports", "boolean", false], ["team_members", "integer", 1],
    ["monitoring_enabled", "boolean", true], ["intelligence_cycles_per_day", "integer", 4], ["intelligence_cycle_interval_minutes", "integer", 360], ["deep_refreshes_per_week", "integer", 1], ["manual_refresh_cooldown_minutes", "integer", 180], ["digest_enabled", "boolean", true], ["priority_alerts_enabled", "boolean", false],
  ].map(([capabilityKey, valueType, value]) => ({ capabilityKey: capabilityKey as string, valueType: valueType as EffectiveEntitlement["valueType"], value: value as EffectiveEntitlement["value"] })),
  growth: [
    ["products_max", "integer", 10], ["signals_monthly", "integer", 2000], ["scan_frequency", "enum", "frequent"],
    ["demand_map", "enum", "advanced"], ["demand_gap", "enum", "advanced"], ["demand_drift_days", "integer", 90],
    ["actions_enabled", "boolean", true], ["experiments_max", "integer", 10], ["exports", "boolean", true], ["team_members", "integer", 3],
    ["monitoring_enabled", "boolean", true], ["intelligence_cycles_per_day", "integer", 12], ["intelligence_cycle_interval_minutes", "integer", 120], ["deep_refreshes_per_week", "integer", 3], ["manual_refresh_cooldown_minutes", "integer", 60], ["digest_enabled", "boolean", true], ["priority_alerts_enabled", "boolean", true],
  ].map(([capabilityKey, valueType, value]) => ({ capabilityKey: capabilityKey as string, valueType: valueType as EffectiveEntitlement["valueType"], value: value as EffectiveEntitlement["value"] })),
};

export class InMemoryBillingRepository implements BillingRepository {
  readonly checkoutRequests = new Map<string, CheckoutReservation>();
  readonly webhookEvents = new Map<string, BillingWebhookEventRow>();
  readonly subscriptions = new Map<string, SubscriptionRow>();
  readonly customers = new Map<string, BillingCustomerRow>();
  readonly revisions = new Map<string, Array<{ plan: BillingOverview["effectivePlan"]; sourceSubscriptionId: string | null; entitlements: EffectiveEntitlement[] }>>();
  readonly usage = new Map<string, Array<{ usageType: string; amount: number }>>();

  seedWorkspace(workspaceId: string): void {
    if (!this.revisions.has(workspaceId)) this.revisions.set(workspaceId, []);
    if (this.revisions.get(workspaceId)?.length === 0) this.resolveEntitlements(workspaceId, "free", null);
  }

  async reserveCheckout(input: { workspaceId: string; checkoutReference: string; plan: BillingPlan; interval: BillingInterval }): Promise<CheckoutReservation> {
    const key = `${input.workspaceId}:${input.checkoutReference}`;
    const existing = this.checkoutRequests.get(key);
    if (existing) return existing;
    const row: CheckoutReservation = {
      id: createId(), workspace_id: input.workspaceId, checkout_reference: input.checkoutReference,
      internal_plan: input.plan, billing_interval: input.interval, provider: "dodo",
      provider_checkout_id: null, checkout_url: null, status: "created", created_at: now(), updated_at: now(),
    };
    this.checkoutRequests.set(key, row);
    return row;
  }

  async completeCheckout(id: string, result: { providerCheckoutId: string; checkoutUrl: string }): Promise<CheckoutReservation> {
    const row = [...this.checkoutRequests.values()].find((candidate) => candidate.id === id);
    if (!row) throw new AppError("NOT_FOUND", "Checkout request was not found.");
    const updated = { ...row, provider_checkout_id: result.providerCheckoutId, checkout_url: result.checkoutUrl, updated_at: now() };
    this.checkoutRequests.set(`${row.workspace_id}:${row.checkout_reference}`, updated);
    return updated;
  }

  async recordWebhook(input: { event: VerifiedBillingEvent; payloadHash: string }): Promise<{ row: BillingWebhookEventRow; duplicate: boolean }> {
    const provider = input.event.provider === "fixture" ? "dodo" : input.event.provider;
    const existing = [...this.webhookEvents.values()].find((row) => row.provider === provider && row.provider_event_id === input.event.providerEventId);
    if (existing) return { row: existing, duplicate: true };
    const row: BillingWebhookEventRow = {
      id: createId(), provider,
      provider_event_id: input.event.providerEventId, event_type: input.event.eventType,
      received_at: now(), provider_occurred_at: input.event.occurredAt, signature_verified: true,
      payload_hash: input.payloadHash, payload: input.event.payload, processing_status: "received",
      processed_at: null, error_code: null, sanitized_error: null, trace_id: null, created_at: now(),
    };
    this.webhookEvents.set(row.id, row);
    return { row, duplicate: false };
  }

  async getWebhook(eventId: string): Promise<BillingWebhookEventRow | null> {
    return this.webhookEvents.get(eventId) ?? null;
  }

  async markWebhook(eventId: string, update: { processingStatus: BillingWebhookEventRow["processing_status"]; processedAt?: string; errorCode?: string; sanitizedError?: string }): Promise<void> {
    const row = this.webhookEvents.get(eventId);
    if (!row) return;
    this.webhookEvents.set(eventId, { ...row, processing_status: update.processingStatus, processed_at: update.processedAt ?? row.processed_at, error_code: update.errorCode ?? null, sanitized_error: update.sanitizedError ?? null });
  }

  async applySubscription(input: { workspaceId: string; subscription: ProviderSubscription; providerEventId: string; actorUserId?: string | null; traceId?: string | null }): Promise<SubscriptionRow> {
    this.seedWorkspace(input.workspaceId);
    const current = this.subscriptions.get(input.subscription.providerSubscriptionId);
    if (current?.provider_updated_at && input.subscription.providerUpdatedAt < current.provider_updated_at) return current;
    const customer: BillingCustomerRow = {
      id: this.customers.get(input.workspaceId)?.id ?? createId(), workspace_id: input.workspaceId, provider: "dodo",
      provider_customer_id: input.subscription.providerCustomerId, email: input.subscription.customerEmail ?? null, status: "active", created_at: now(), updated_at: now(),
    };
    this.customers.set(input.workspaceId, customer);
    const row: SubscriptionRow = {
      id: current?.id ?? createId(), workspace_id: input.workspaceId, billing_customer_id: customer.id, provider: "dodo",
      provider_subscription_id: input.subscription.providerSubscriptionId, internal_plan: input.subscription.internalPlan, billing_interval: input.subscription.billingInterval,
      status: input.subscription.status, current_period_start: input.subscription.currentPeriodStart ?? null, current_period_end: input.subscription.currentPeriodEnd ?? null,
      cancel_at_period_end: input.subscription.cancelAtPeriodEnd, canceled_at: input.subscription.canceledAt ?? null, ended_at: input.subscription.endedAt ?? null,
      payment_failure_state: input.subscription.paymentFailureState ?? null, provider_product_id: input.subscription.providerProductId,
      provider_price_reference: input.subscription.providerPriceReference ?? null, provider_updated_at: input.subscription.providerUpdatedAt,
      last_provider_event_id: input.providerEventId, created_at: current?.created_at ?? now(), updated_at: now(),
    };
    this.subscriptions.set(row.provider_subscription_id, row);
    if (row.status !== "past_due") {
      const plan = ["active", "trialing", "canceling"].includes(input.subscription.status) ? input.subscription.internalPlan : "free";
      this.resolveEntitlements(input.workspaceId, plan, row.id);
    }
    return row;
  }

  async getCurrentSubscription(workspaceId: string): Promise<SubscriptionRow | null> {
    return [...this.subscriptions.values()].filter((row) => row.workspace_id === workspaceId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  }

  async findWorkspaceByProviderSubscriptionId(providerSubscriptionId: string): Promise<string | null> {
    return this.subscriptions.get(providerSubscriptionId)?.workspace_id ?? null;
  }

  async getOverview(workspaceId: string): Promise<BillingOverview> {
    this.seedWorkspace(workspaceId);
    const current = this.revisions.get(workspaceId)?.at(-1);
    return { subscription: publicSubscription(await this.getCurrentSubscription(workspaceId)), effectivePlan: current?.plan ?? "free", entitlements: current?.entitlements ?? [], usage: this.usage.get(workspaceId) ?? [] };
  }

  private resolveEntitlements(workspaceId: string, plan: BillingOverview["effectivePlan"], sourceSubscriptionId: string | null): void {
    const revisions = this.revisions.get(workspaceId) ?? [];
    const current = revisions.at(-1);
    if (current?.plan === plan && current.sourceSubscriptionId === sourceSubscriptionId) return;
    revisions.push({ plan, sourceSubscriptionId, entitlements: clone(catalogValues[plan]) });
    this.revisions.set(workspaceId, revisions);
  }
}

type BillingSupabaseClient = SupabaseJsClient<Database>;

function repositoryError(message: string, error: { message?: string; code?: string }): AppError {
  if (error.code === "42501") return new AppError("FORBIDDEN", "Billing access was denied.");
  if (error.code === "23505") return new AppError("CONFLICT", "The billing operation was already recorded.");
  return new AppError("INTERNAL_ERROR", message, 500, { providerMessage: error.message });
}

export class SupabaseBillingRepository implements BillingRepository {
  constructor(private readonly client: BillingSupabaseClient) {}

  async reserveCheckout(input: { workspaceId: string; checkoutReference: string; plan: BillingPlan; interval: BillingInterval }): Promise<CheckoutReservation> {
    const existing = await this.client.from("billing_checkout_requests").select("*").eq("workspace_id", input.workspaceId).eq("checkout_reference", input.checkoutReference).maybeSingle();
    if (existing.error) throw repositoryError("Checkout request could not be loaded.", existing.error);
    if (existing.data) return existing.data;
    const inserted = await this.client.from("billing_checkout_requests").insert({ workspace_id: input.workspaceId, checkout_reference: input.checkoutReference, internal_plan: input.plan, billing_interval: input.interval }).select("*").single();
    if (inserted.error || !inserted.data) throw repositoryError("Checkout request could not be reserved.", inserted.error ?? { message: "No checkout request returned." });
    return inserted.data;
  }

  async completeCheckout(id: string, result: { providerCheckoutId: string; checkoutUrl: string }): Promise<CheckoutReservation> {
    const response = await this.client.from("billing_checkout_requests").update({ provider_checkout_id: result.providerCheckoutId, checkout_url: result.checkoutUrl }).eq("id", id).select("*").single();
    if (response.error || !response.data) throw repositoryError("Checkout request could not be completed.", response.error ?? { message: "No checkout request returned." });
    return response.data;
  }

  async recordWebhook(input: { event: VerifiedBillingEvent; payloadHash: string }): Promise<{ row: BillingWebhookEventRow; duplicate: boolean }> {
    const provider = input.event.provider === "fixture" ? "dodo" : input.event.provider;
    const existing = await this.client.from("billing_webhook_events").select("*").eq("provider", provider).eq("provider_event_id", input.event.providerEventId).maybeSingle();
    if (existing.error) throw repositoryError("Billing webhook inbox could not be checked.", existing.error);
    if (existing.data) return { row: existing.data, duplicate: true };
    const inserted = await this.client.from("billing_webhook_events").insert({ provider, provider_event_id: input.event.providerEventId, event_type: input.event.eventType, provider_occurred_at: input.event.occurredAt, signature_verified: true, payload_hash: input.payloadHash, payload: input.event.payload }).select("*").single();
    if (inserted.error || !inserted.data) throw repositoryError("Billing webhook could not be recorded.", inserted.error ?? { message: "No webhook row returned." });
    return { row: inserted.data, duplicate: false };
  }

  async getWebhook(eventId: string): Promise<BillingWebhookEventRow | null> {
    const response = await this.client.from("billing_webhook_events").select("*").eq("id", eventId).maybeSingle();
    if (response.error) throw repositoryError("Billing webhook could not be loaded.", response.error);
    return response.data;
  }

  async markWebhook(eventId: string, update: { processingStatus: BillingWebhookEventRow["processing_status"]; processedAt?: string; errorCode?: string; sanitizedError?: string }): Promise<void> {
    const response = await this.client.from("billing_webhook_events").update({ processing_status: update.processingStatus, processed_at: update.processedAt, error_code: update.errorCode, sanitized_error: update.sanitizedError }).eq("id", eventId);
    if (response.error) throw repositoryError("Billing webhook status could not be updated.", response.error);
  }

  async applySubscription(input: { workspaceId: string; subscription: ProviderSubscription; providerEventId: string; actorUserId?: string | null; traceId?: string | null }): Promise<SubscriptionRow> {
    const subscription = input.subscription;
    if (!subscription.customerEmail?.trim()) {
      throw new AppError("VALIDATION_ERROR", "Billing customer email is required to normalize a subscription.");
    }
    type ApplyArgs = Database["public"]["Functions"]["apply_normalized_subscription"]["Args"];
    const args: ApplyArgs = {
      p_workspace_id: input.workspaceId,
      p_provider_customer_id: subscription.providerCustomerId,
      p_customer_email: subscription.customerEmail,
      p_provider_subscription_id: subscription.providerSubscriptionId,
      p_internal_plan: subscription.internalPlan,
      p_billing_interval: subscription.billingInterval,
      p_status: subscription.status,
      p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
      p_provider_product_id: subscription.providerProductId,
      p_provider_updated_at: subscription.providerUpdatedAt,
      p_provider_event_id: input.providerEventId,
    };
    if (subscription.currentPeriodStart !== undefined && subscription.currentPeriodStart !== null) args.p_current_period_start = subscription.currentPeriodStart;
    if (subscription.currentPeriodEnd !== undefined && subscription.currentPeriodEnd !== null) args.p_current_period_end = subscription.currentPeriodEnd;
    if (subscription.canceledAt !== undefined && subscription.canceledAt !== null) args.p_canceled_at = subscription.canceledAt;
    if (subscription.endedAt !== undefined && subscription.endedAt !== null) args.p_ended_at = subscription.endedAt;
    if (subscription.paymentFailureState !== undefined && subscription.paymentFailureState !== null) args.p_payment_failure_state = subscription.paymentFailureState;
    if (subscription.providerPriceReference !== undefined && subscription.providerPriceReference !== null) args.p_provider_price_reference = subscription.providerPriceReference;
    if (input.actorUserId) args.p_actor_user_id = input.actorUserId;
    if (input.traceId) args.p_trace_id = input.traceId;
    const response = await this.client.rpc("apply_normalized_subscription", args);
    if (response.error || !response.data) throw repositoryError("Subscription could not be normalized.", response.error ?? { message: "No subscription returned." });
    await ensureMonitoringSchedulesForActiveProducts(this.client, new Date().toISOString()).catch((error) => {
      if (process.env.NODE_ENV !== "production") console.warn("[monitoring] schedule policy refresh failed after billing change", error instanceof Error ? error.message : "unknown error");
    });
    return response.data;
  }

  async getCurrentSubscription(workspaceId: string): Promise<SubscriptionRow | null> {
    const response = await this.client.from("subscriptions").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (response.error) throw repositoryError("Subscription could not be loaded.", response.error);
    return response.data;
  }

  async findWorkspaceByProviderSubscriptionId(providerSubscriptionId: string): Promise<string | null> {
    const response = await this.client.from("subscriptions").select("workspace_id").eq("provider_subscription_id", providerSubscriptionId).maybeSingle();
    if (response.error) throw repositoryError("Subscription owner could not be loaded.", response.error);
    return response.data?.workspace_id ?? null;
  }

  async getOverview(workspaceId: string): Promise<BillingOverview> {
    const [subscription, entitlements, usage] = await Promise.all([
      this.getCurrentSubscription(workspaceId),
      this.client.from("workspace_entitlements").select("capability_key, value_type, value_json, plan_catalog_id").eq("workspace_id", workspaceId).is("effective_to", null),
      this.client.rpc("get_usage_totals", { p_workspace_id: workspaceId }),
    ]);
    if (entitlements.error) throw repositoryError("Entitlements could not be loaded.", entitlements.error);
    if (usage.error) throw repositoryError("Usage could not be loaded.", usage.error);
    const plan = subscription?.status && ["active", "trialing", "past_due", "canceling"].includes(subscription.status) ? subscription.internal_plan : "free";
    return {
      subscription: publicSubscription(subscription),
      effectivePlan: plan as BillingOverview["effectivePlan"],
      entitlements: (entitlements.data ?? []).map((row) => ({ capabilityKey: row.capability_key, valueType: row.value_type as EffectiveEntitlement["valueType"], value: entitlementValue(row.value_type as EffectiveEntitlement["valueType"], row.value_json) })),
      usage: (usage.data ?? []).map((row) => ({ usageType: row.usage_type, amount: row.amount })),
    };
  }
}
