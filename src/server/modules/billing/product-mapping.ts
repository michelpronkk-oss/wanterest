import { AppError } from "../../lib/errors";
import { getServerEnv } from "../../lib/env";
import type { BillingInterval, BillingPlan } from "./billing.schemas";

export type DodoProductMapping = {
  providerProductId: string;
  internalPlan: BillingPlan;
  billingInterval: BillingInterval;
};

export type DodoProductCatalog = {
  proMonthly: DodoProductMapping;
  proAnnual: DodoProductMapping;
  growthMonthly: DodoProductMapping;
  growthAnnual: DodoProductMapping;
};

export function createDodoProductCatalog(values: {
  proMonthly: string;
  proAnnual: string;
  growthMonthly: string;
  growthAnnual: string;
}): DodoProductCatalog {
  const productIds = [values.proMonthly, values.proAnnual, values.growthMonthly, values.growthAnnual]
    .map((value) => value.trim());
  if (productIds.some((value) => value.length === 0)) {
    throw new AppError("BILLING_CONFIG_ERROR", "Dodo product mapping is not configured.", 500, { reason: "missing_product_mapping" });
  }
  if (new Set(productIds).size !== productIds.length) {
    throw new AppError("BILLING_CONFIG_ERROR", "Dodo product mapping contains duplicate product IDs.", 500, { reason: "duplicate_product_mapping" });
  }
  return {
    proMonthly: { providerProductId: productIds[0], internalPlan: "pro", billingInterval: "monthly" },
    proAnnual: { providerProductId: productIds[1], internalPlan: "pro", billingInterval: "annual" },
    growthMonthly: { providerProductId: productIds[2], internalPlan: "growth", billingInterval: "monthly" },
    growthAnnual: { providerProductId: productIds[3], internalPlan: "growth", billingInterval: "annual" },
  };
}

export function getDodoProductCatalog(): DodoProductCatalog {
  const env = getServerEnv();
  const values = {
    proMonthly: env.DODO_PRODUCT_PRO_MONTHLY,
    proAnnual: env.DODO_PRODUCT_PRO_ANNUAL,
    growthMonthly: env.DODO_PRODUCT_GROWTH_MONTHLY,
    growthAnnual: env.DODO_PRODUCT_GROWTH_ANNUAL,
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new AppError("BILLING_CONFIG_ERROR", "Dodo product mapping is not configured.", 500, { reason: "missing_product_mapping", missing });
  }
  return createDodoProductCatalog(values as Record<keyof typeof values, string>);
}

export function productFor(catalog: DodoProductCatalog, plan: BillingPlan, interval: BillingInterval): DodoProductMapping {
  const mapping = plan === "pro"
    ? interval === "monthly" ? catalog.proMonthly : catalog.proAnnual
    : interval === "monthly" ? catalog.growthMonthly : catalog.growthAnnual;
  return mapping;
}

export function findProductMapping(catalog: DodoProductCatalog, providerProductId: string): DodoProductMapping | undefined {
  return Object.values(catalog).find((mapping) => mapping.providerProductId === providerProductId);
}
