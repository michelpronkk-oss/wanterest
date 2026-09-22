"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { ProductRow, WorkspaceRow } from "@/server/db/database.helpers";
import { switchProductAction, switchWorkspaceAction } from "@/app/app/actions";
import { domainFromUrl } from "./dashboard-utils";

type Props = {
  workspaces: Array<Pick<WorkspaceRow, "id" | "name" | "slug" | "status">>;
  workspace: Pick<WorkspaceRow, "id" | "name" | "slug" | "status"> | null;
  products: Array<Pick<ProductRow, "id" | "workspace_id" | "name" | "slug" | "website_url" | "status" | "current_snapshot_id" | "current_demand_profile_id">>;
  product: Pick<ProductRow, "id" | "workspace_id" | "name" | "slug" | "website_url" | "status" | "current_snapshot_id" | "current_demand_profile_id"> | null;
};

export function ContextSwitchers({ workspaces, workspace, products, product }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function changeWorkspace(workspaceId: string) {
    if (workspaceId === workspace?.id) return setOpen(false);
    setError(null);
    setOpen(false);
    startTransition(() => {
      void switchWorkspaceAction({ workspaceId, returnTo }).catch(() => setError("Workspace could not be changed."));
    });
  }

  function changeProduct(productId: string) {
    if (!workspace || productId === product?.id) return setOpen(false);
    setError(null);
    setOpen(false);
    startTransition(() => {
      void switchProductAction({ workspaceId: workspace.id, productId, returnTo }).catch(() => setError("Product could not be changed."));
    });
  }

  const domain = domainFromUrl(product?.website_url);

  return (
    <div className="sidebar-context" ref={containerRef}>
      <button
        type="button"
        className="sidebar-context-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={isPending || workspaces.length === 0}
      >
        <div className="sidebar-context-text">
          <span className="sidebar-context-workspace">{workspace?.name ?? "No workspace"}</span>
          <div className="sidebar-context-product-row">
            {product ? (
              <span className="sidebar-context-product">
                {product.name}
                {domain ? ` · ${domain}` : ""}
              </span>
            ) : (
              <>
                <span className="sidebar-context-product is-empty">No product selected</span>
                {workspace ? (
                  <Link
                    href="/app/setup/product"
                    className="sidebar-context-add-inline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    + Add product
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>
        <svg className="sidebar-context-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="sidebar-context-popover" role="menu" aria-label="Switch workspace or product">
          <div className="sidebar-context-group">
            <div className="sidebar-context-group-label">Workspace</div>
            {workspaces.length === 0 ? (
              <p className="sidebar-context-empty">No workspaces yet</p>
            ) : (
              workspaces.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.id === workspace?.id}
                  className={`sidebar-context-option${item.id === workspace?.id ? " is-active" : ""}`}
                  onClick={() => changeWorkspace(item.id)}
                >
                  {item.id === workspace?.id ? <span className="sidebar-context-option-dot" aria-hidden="true" /> : null}
                  {item.name}
                </button>
              ))
            )}
          </div>

          {workspace ? (
            <div className="sidebar-context-group">
              <div className="sidebar-context-group-label">Product</div>
              {products.length === 0 ? (
                <p className="sidebar-context-empty">No products yet</p>
              ) : (
                products.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={item.id === product?.id}
                    className={`sidebar-context-option${item.id === product?.id ? " is-active" : ""}`}
                    onClick={() => changeProduct(item.id)}
                  >
                    {item.id === product?.id ? <span className="sidebar-context-option-dot" aria-hidden="true" /> : null}
                    {item.name}
                  </button>
                ))
              )}
              <Link href="/app/setup/product?new=1" className="sidebar-context-link" onClick={() => setOpen(false)}>
                + Add product
              </Link>
            </div>
          ) : null}

          <div className="sidebar-context-footer">
            <Link href="/app/settings?tab=general" onClick={() => setOpen(false)}>
              Manage workspace
            </Link>
          </div>
        </div>
      ) : null}

      {error ? <p className="dashboard-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
