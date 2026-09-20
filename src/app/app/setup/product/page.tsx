import { redirect } from "next/navigation";

import { ProductSetupForm, ProductUnderstandingForm } from "@/components/onboarding/setup-forms";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

export default async function ProductSetupPage() {
  const { workspace, product } = await getDashboardContext();
  if (!workspace) redirect("/app/setup/workspace");
  if (product && product.current_snapshot_id && product.current_demand_profile_id) redirect("/app/setup/scan");
  return (
    <section className="dashboard-page onboarding-page">
      <p className="dashboard-eyebrow">First setup</p>
      <h1>{product ? "Tell us about your product." : "Add your first product."}</h1>
      <p className="dashboard-subtitle">This context anchors the first scan and keeps every result traceable to your product.</p>
      <div className="dashboard-panel onboarding-panel">
        {product ? <ProductUnderstandingForm workspaceId={workspace.id} productId={product.id} websiteUrl={product.website_url} /> : <ProductSetupForm workspaceId={workspace.id} />}
      </div>
    </section>
  );
}
