export type OnboardingProductCandidate = {
  id: string;
  slug: string;
  website_url: string | null;
  status: string;
  current_snapshot_id: string | null;
  current_demand_profile_id: string | null;
};

export function findExistingOnboardingProduct<T extends OnboardingProductCandidate>(
  products: readonly T[],
  input: { slug: string; websiteUrl: string },
): T | undefined {
  return products.find((product) => product.slug === input.slug || product.website_url === input.websiteUrl);
}

export function needsOnboardingUnderstanding(product: Pick<OnboardingProductCandidate, "current_snapshot_id" | "current_demand_profile_id">): boolean {
  return !product.current_snapshot_id || !product.current_demand_profile_id;
}

export function hasCompletedOnboardingUnderstanding(product: Pick<OnboardingProductCandidate, "current_snapshot_id" | "current_demand_profile_id">): boolean {
  return Boolean(product.current_snapshot_id && product.current_demand_profile_id);
}
