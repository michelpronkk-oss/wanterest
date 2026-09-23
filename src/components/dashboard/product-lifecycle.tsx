"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { ProductRow } from "@/server/db/database.helpers";
import { archiveProductAction } from "@/app/app/actions";
import { domainFromUrl } from "./dashboard-utils";
import { UpgradeTrigger, type UpgradePlan } from "./upgrade-surface";

type Props = {
  workspaceId: string;
  activeProduct: Pick<ProductRow, "id" | "name" | "website_url"> | null;
  activeProductCount: number;
  maxProducts: number;
  currentPlan: UpgradePlan;
  archivedProducts: Array<Pick<ProductRow, "id" | "name" | "website_url">>;
};

export function ProductLifecycle({ workspaceId, activeProduct, activeProductCount, maxProducts, currentPlan, archivedProducts }: Props) {
  const router = useRouter();
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    if (!activeProduct || pendingProductId) return;
    const confirmed = window.confirm(`Archive ${activeProduct.name}? Stop tracking it and free the product slot. Historical intelligence will be preserved.`);
    if (!confirmed) return;
    setError(null);
    setPendingProductId(activeProduct.id);
    const result = await archiveProductAction({ workspaceId, productId: activeProduct.id });
    if (!result.ok) {
      setError(result.error);
      setPendingProductId(null);
      return;
    }
    router.replace(result.nextPath);
  }

  return (
    <div className="ui-card ui-card-pad-lg" style={{ marginTop: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Product management</div>
      {activeProduct ? (
        <div style={{ borderTop: "1px solid var(--color-border-soft)", paddingTop: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{activeProduct.name}</div>
          <p style={{ fontSize: 12.5, color: "var(--color-ink-muted)", margin: "5px 0 12px" }}>
            Stop tracking this product and free a product slot. Historical intelligence will be preserved.
          </p>
          <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => void archive()} disabled={pendingProductId !== null}>
            {pendingProductId === activeProduct.id ? "Archiving…" : "Archive product"}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: "var(--color-ink-muted)", margin: "8px 0 0" }}>No active product is currently being tracked.</p>
      )}

      {activeProductCount >= maxProducts ? (
        <div className="capability-gate" style={{ marginTop: 18 }}>
          <div className="capability-gate-copy"><span className="capability-gate-kicker">Product access</span><h2>Product limit reached</h2><p>Your {currentPlan} plan includes {maxProducts} active product{maxProducts === 1 ? "" : "s"}. Archive one to free a slot or upgrade your plan.</p></div>
          {currentPlan === "growth" ? <Link className="dashboard-button dashboard-button-secondary" href="/app/settings/billing">Manage billing</Link> : <UpgradeTrigger workspaceId={workspaceId} currentPlan={currentPlan} label="Upgrade plan" />}
        </div>
      ) : null}

      <div style={{ borderTop: "1px solid var(--color-border-soft)", marginTop: 18, paddingTop: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Archived products</div>
        {archivedProducts.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--color-ink-muted)", margin: 0 }}>Archived products will appear here.</p>
        ) : (
          <div>
            {archivedProducts.map((product) => (
              <div key={product.id} className="settings-row" style={{ padding: "11px 0" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{product.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-muted)" }}>{domainFromUrl(product.website_url) ?? "No domain"} · Archived</div>
                </div>
                <span className="badge badge-neutral">Archived</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {error ? <p className="dashboard-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
