import Link from "next/link";

import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

export default async function AppOverviewPage() {
  const { workspace, product, products } = await getDashboardContext();

  if (!workspace) {
    return (
      <section className="dashboard-page dashboard-state">
        <p className="dashboard-eyebrow">Welcome to Wanterest</p>
        <h1>Create your first workspace</h1>
        <p>Your account is ready. Create a workspace to start collecting product context and demand Signals.</p>
        <Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link>
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <div>
          <p className="dashboard-eyebrow">Overview</p>
          <h1>Good to see you, {workspace.name}.</h1>
          <p className="dashboard-subtitle">A grounded view of the demand signals shaping {product?.name ?? "your product"}.</p>
        </div>
        <div className="dashboard-header-context">
          <span className="dashboard-context-label">Active product</span>
          <strong>{product?.name ?? "No product selected"}</strong>
        </div>
      </header>

      {!product ? (
        <div className="dashboard-panel dashboard-state">
          <p className="dashboard-eyebrow">Product context needed</p>
          <h2>Create or select a product</h2>
          <p>Signals and demand intelligence are product-scoped. Add your first product to prepare the initial scan.</p>
          <Link className="dashboard-button dashboard-button-primary" href="/app/setup/product">Add product</Link>
        </div>
      ) : (
        <>
          <div className="dashboard-stat-grid" aria-label="Workspace facts">
            <article className="dashboard-stat-card"><span>Workspace</span><strong>{workspace.name}</strong><small>{workspace.slug}</small></article>
            <article className="dashboard-stat-card"><span>Products</span><strong>{products.length}</strong><small>Accessible in this workspace</small></article>
            <article className="dashboard-stat-card"><span>Current product</span><strong>{product.name}</strong><small>{product.slug}</small></article>
          </div>
          <div className="dashboard-panel dashboard-overview-callout">
            <div>
              <p className="dashboard-eyebrow">Start with Signals</p>
              <h2>Find the conversations worth your attention.</h2>
              <p>The Signals view uses the existing scored backend read model, with source, rationale, lifecycle, and evidence links kept visible for inspection.</p>
            </div>
            <Link className="dashboard-button dashboard-button-primary" href="/app/signals">Open Signals</Link>
          </div>
        </>
      )}
    </section>
  );
}
