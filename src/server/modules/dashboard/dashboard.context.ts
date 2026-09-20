import "server-only";

import { cookies } from "next/headers";

import type { ProductRow, WorkspaceRow } from "@/server/db/database.helpers";
import { listProductsQuery } from "@/server/modules/products";
import { listWorkspacesQuery } from "@/server/modules/workspaces";
import { requireUser } from "@/server/modules/auth";

export const ACTIVE_PRODUCT_COOKIE = "wanterest_active_product";

export type DashboardContext = {
  userEmail: string | null;
  workspaces: WorkspaceRow[];
  workspace: WorkspaceRow | null;
  products: ProductRow[];
  product: ProductRow | null;
};

/**
 * Resolve dashboard context from authenticated membership plus server-managed
 * selection cookies. Cookie values are only hints: the selected rows must be
 * present in the RLS-filtered workspace/product lists before they are used.
 */
export async function getDashboardContext(): Promise<DashboardContext> {
  const user = await requireUser();
  const workspaces = await listWorkspacesQuery();
  const cookieStore = await cookies();
  const selectedWorkspaceId = cookieStore.get("wanterest_active_workspace")?.value;
  const workspace =
    workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ??
    workspaces[0] ??
    null;

  if (!workspace) {
    return { userEmail: user.email ?? null, workspaces, workspace: null, products: [], product: null };
  }

  const products = await listProductsQuery(workspace.id);
  const selectedProductId = cookieStore.get(ACTIVE_PRODUCT_COOKIE)?.value;
  const product =
    products.find((candidate) => candidate.id === selectedProductId) ??
    products[0] ??
    null;

  return { userEmail: user.email ?? null, workspaces, workspace, products, product };
}
