import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { ProductContextRow } from "@/server/modules/products";
import { listDashboardProductsQuery } from "@/server/modules/products";
import type { WorkspaceContextRow } from "@/server/modules/workspaces";
import { listDashboardWorkspacesQuery } from "@/server/modules/workspaces";
import { requireUser } from "@/server/modules/auth";
import { partitionProducts } from "@/server/modules/products/product-lifecycle";

export const ACTIVE_PRODUCT_COOKIE = "wanterest_active_product";

export type DashboardContext = {
  userEmail: string | null;
  workspaces: WorkspaceContextRow[];
  workspace: WorkspaceContextRow | null;
  /** Active products only; archived products cannot become dashboard context. */
  products: ProductContextRow[];
  archivedProducts: ProductContextRow[];
  product: ProductContextRow | null;
};

/**
 * Resolve dashboard context from authenticated membership plus server-managed
 * selection cookies. Cookie values are only hints: the selected rows must be
 * present in the RLS-filtered workspace/product lists before they are used.
 */
async function resolveDashboardContext(): Promise<DashboardContext> {
  const user = await requireUser();
  const workspaces = await listDashboardWorkspacesQuery();
  const cookieStore = await cookies();
  const selectedWorkspaceId = cookieStore.get("wanterest_active_workspace")?.value;
  const workspace =
    workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ??
    workspaces[0] ??
    null;

  if (!workspace) {
    return { userEmail: user.email ?? null, workspaces, workspace: null, products: [], archivedProducts: [], product: null };
  }

  const allProducts = await listDashboardProductsQuery(workspace.id);
  const { active: products, archived: archivedProducts } = partitionProducts(allProducts);
  const selectedProductId = cookieStore.get(ACTIVE_PRODUCT_COOKIE)?.value;
  const product =
    products.find((candidate) => candidate.id === selectedProductId) ??
    products[0] ??
    null;

  return { userEmail: user.email ?? null, workspaces, workspace, products, archivedProducts, product };
}

// Multiple route-group layouts and pages can ask for the same context during
// one render. Keep this memoized per request so selection and auth state cannot
// drift between those reads, while avoiding any global cache.
export const getDashboardContext = cache(resolveDashboardContext);

export type OnboardingRedirectPath = "/app/setup/workspace" | "/app/setup/product";

/**
 * Single source of truth for "is the active workspace/product ready for the normal app shell?"
 * Returns the setup route to redirect to, or null once workspace + product + product
 * understanding (snapshot and demand profile) all exist. Shared by the product route group's
 * onboarding gate and the /app/setup router so both agree on what "ready" means.
 */
export function resolveOnboardingStep(context: Pick<DashboardContext, "workspace" | "product">): OnboardingRedirectPath | null {
  if (!context.workspace) return "/app/setup/workspace";
  if (!context.product) return "/app/setup/product";
  if (!context.product.current_snapshot_id || !context.product.current_demand_profile_id) return "/app/setup/product";
  return null;
}
