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
  return {
    proMonthly: { providerProductId: values.proMonthly, internalPlan: "pro", billingInterval: "monthly" },
    proAnnual: { providerProductId: values.proAnnual, internalPlan: "pro", billingInterval: "annual" },
    growthMonthly: { providerProductId: values.growthMonthly, internalPlan: "growth", billingInterval: "monthly" },
    growthAnnual: { providerProductId: values.growthAnnual, internalPlan: "growth", billingInterval: "annual" },
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
  if (Object.values(values).some((value) => !value)) {
    throw new Error("Dodo product mapping is not configured.");
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
