import type { JsonObject } from "../../db/database.helpers";
import type { BillingInterval, BillingPlan } from "../../modules/billing/billing.schemas";

export type BillingProviderName = "dodo" | "fixture";

export type ProviderSubscriptionStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceling"
  | "canceled"
  | "expired"
  | "incomplete";

export type ProviderSubscription = {
  providerSubscriptionId: string;
  providerCustomerId: string;
  customerEmail?: string | null;
  providerProductId: string;
  providerPriceReference?: string | null;
  internalPlan: BillingPlan;
  billingInterval: BillingInterval;
  status: ProviderSubscriptionStatus;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string | null;
  endedAt?: string | null;
  paymentFailureState?: string | null;
  providerDiscounts?: ProviderDiscountSnapshot[];
  providerUpdatedAt: string;
};

export type ProviderDiscountSnapshot = {
  providerDiscountId: string;
  code: string;
  amountBasisPoints: number;
  restrictedTo: string[];
  customerEligibility?: "any" | "first_time" | "existing" | "specific";
  expiresAt?: string | null;
  subscriptionCycles?: number | null;
  cyclesRemaining?: number | null;
  preserveOnPlanChange: boolean;
  usageLimit?: number | null;
  metadata: Record<string, string | number | boolean>;
};

export type ProviderDiscountCreateRequest = {
  amountBasisPoints: number;
  productIds: string[];
  expiresAt?: string | null;
  subscriptionCycles: number;
  metadata: Record<string, string | number | boolean>;
  idempotencyKey: string;
};

export type CheckoutRequest = {
  workspaceId: string;
  internalPlan: BillingPlan;
  billingInterval: BillingInterval;
  providerProductId: string;
  providerCustomerId?: string | null;
  returnUrl?: string;
  checkoutReference: string;
  discountCodes?: string[];
};

export type CheckoutResult = {
  providerCheckoutId: string;
  checkoutUrl: string;
};

export type PortalSessionResult = {
  portalUrl: string;
};

export type VerifiedBillingEvent = {
  provider: BillingProviderName;
  providerEventId: string;
  eventType: string;
  occurredAt: string;
  payload: JsonObject;
  workspaceId?: string;
  subscription?: ProviderSubscription;
  diagnostic?: { code: string; message: string };
};

export type WebhookHeaders = Record<string, string | undefined>;

export interface BillingProvider {
  readonly name: BillingProviderName;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  createPortalSession?(providerCustomerId: string, returnUrl?: string): Promise<PortalSessionResult>;
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;
  createDiscount?(input: ProviderDiscountCreateRequest): Promise<ProviderDiscountSnapshot>;
  getDiscount?(providerDiscountId: string): Promise<ProviderDiscountSnapshot>;
  deleteDiscount?(providerDiscountId: string): Promise<void>;
  cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;
  changeSubscription?(input: {
    providerSubscriptionId: string;
    providerProductId: string;
    billingInterval: BillingInterval;
    discountCodes?: string[];
  }): Promise<ProviderSubscription>;
  verifyWebhook(rawBody: string, headers: WebhookHeaders, now?: Date): Promise<VerifiedBillingEvent>;
  normalizeStoredWebhook(payload: JsonObject, context: { providerEventId: string; occurredAt: string; eventType: string }): VerifiedBillingEvent;
  /** Read-only auth/connectivity probe against a harmless list endpoint. Never mutates billing data. */
  checkConnectivity?(): Promise<{ ok: true } | { ok: false; code: BillingProviderError["code"]; message: string }>;
}

export class BillingProviderError extends Error {
  constructor(
    // UNAUTHORIZED (HTTP 401) means the credentials themselves were not accepted;
    // FORBIDDEN (HTTP 403) means the credentials were accepted but the account/key
    // is not permitted to perform this specific action. Collapsing the two loses the
    // exact signal needed to tell "misconfigured key" apart from "key configured,
    // account/action not authorized" (e.g. live mode not activated, wrong product
    // environment, IP allowlist). NOT_FOUND (404) is likewise kept distinct from a
    // 422 payload/product validation failure (INVALID_REQUEST).
    public readonly code: "CONFIGURATION" | "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "UNAVAILABLE" | "PROVIDER_ERROR",
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "BillingProviderError";
  }
}
