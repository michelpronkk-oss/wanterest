"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { ProductRow, WorkspaceRow } from "@/server/db/database.helpers";
import { switchProductAction, switchWorkspaceAction } from "@/app/app/actions";

type Props = {
  workspaces: WorkspaceRow[];
  workspace: WorkspaceRow | null;
  products: ProductRow[];
  product: ProductRow | null;
};

export function ContextSwitchers({ workspaces, workspace, products, product }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;

  function changeWorkspace(workspaceId: string) {
    setError(null);
    startTransition(() => {
      void switchWorkspaceAction({ workspaceId, returnTo }).catch(() => setError("Workspace could not be changed."));
    });
  }

  function changeProduct(productId: string) {
    if (!workspace) return;
    setError(null);
    startTransition(() => {
      void switchProductAction({ workspaceId: workspace.id, productId, returnTo }).catch(() => setError("Product could not be changed."));
    });
  }

  return (
    <div className="dashboard-context" aria-label="Current context">
      <label className="dashboard-field">
        <span>Workspace</span>
        <select aria-label="Select workspace" disabled={isPending || workspaces.length === 0} value={workspace?.id ?? ""} onChange={(event) => changeWorkspace(event.target.value)}>
          {workspaces.length === 0 ? <option value="">No workspaces yet</option> : null}
          {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="dashboard-field">
        <span>Product</span>
        <select aria-label="Select product" disabled={isPending || products.length === 0} value={product?.id ?? ""} onChange={(event) => changeProduct(event.target.value)}>
          {products.length === 0 ? <option value="">No products yet</option> : null}
          {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {error ? <p className="dashboard-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
