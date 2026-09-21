export type ProductLifecycleCandidate = { status: string };

export function isActiveProduct(product: ProductLifecycleCandidate): boolean {
  return product.status === "active";
}

export function partitionProducts<T extends ProductLifecycleCandidate>(products: T[]): { active: T[]; archived: T[] } {
  return {
    active: products.filter(isActiveProduct),
    archived: products.filter((product) => !isActiveProduct(product)),
  };
}

export function nextActiveProductId(selectedProductId: string | null, archivedProductId: string, activeProductIds: string[]): string | null {
  if (selectedProductId === archivedProductId || !selectedProductId || !activeProductIds.includes(selectedProductId)) {
    return activeProductIds[0] ?? null;
  }
  return selectedProductId;
}
