import type { CohortName } from "../cohorts/cohort-membership.schemas";

export type CohortBenefitPolicy = {
  policyKey: "founding_25_v1" | "early_100_v1";
  cohort: CohortName;
  discountPercent: number;
  durationMonths: number;
  activationTrigger: "first_paid_subscription";
};

export const cohortBenefitPolicies: Record<CohortBenefitPolicy["policyKey"], CohortBenefitPolicy> = {
  founding_25_v1: {
    policyKey: "founding_25_v1",
    cohort: "founding_25",
    discountPercent: 30,
    durationMonths: 24,
    activationTrigger: "first_paid_subscription",
  },
  early_100_v1: {
    policyKey: "early_100_v1",
    cohort: "early_100",
    discountPercent: 15,
    durationMonths: 12,
    activationTrigger: "first_paid_subscription",
  },
};

export function policyForCohort(cohort: CohortName): CohortBenefitPolicy {
  return cohort === "founding_25" ? cohortBenefitPolicies.founding_25_v1 : cohortBenefitPolicies.early_100_v1;
}
