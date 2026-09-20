import { processBillingWebhookJob, reconcileBillingSubscriptionJob } from "../../modules/billing";

export function billingWebhookJobIdempotency(provider: string, providerEventId: string): string {
  return `billing-webhook:${provider}:${providerEventId}`;
}

export function billingReconciliationJobIdempotency(subscriptionId: string, providerUpdatedAt: string): string {
  return `billing-reconcile:${subscriptionId}:${providerUpdatedAt}`;
}

export async function runProcessBillingWebhookJob(eventId: string, traceId?: string) {
  return processBillingWebhookJob(eventId, traceId);
}

export async function runReconcileBillingSubscriptionJob(workspaceId: string) {
  return reconcileBillingSubscriptionJob(workspaceId);
}
