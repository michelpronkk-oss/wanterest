import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";

const sections: Record<string, { label: string; description: string }> = {
  demand: { label: "Demand", description: "Demand themes and snapshots will use the same workspace and product context here." },
  map: { label: "Map", description: "The demand map is reserved for the next dashboard slice." },
  gap: { label: "Gap", description: "Gap analysis will appear here when its read model is brought into the dashboard." },
  drift: { label: "Drift", description: "Drift monitoring will appear here when its read model is brought into the dashboard." },
  actions: { label: "Actions", description: "Actions remain backend-enabled, but their dashboard workflow is intentionally not part of this foundation." },
  experiments: { label: "Experiments", description: "Experiments remain backend-enabled, but their dashboard workflow is intentionally not part of this foundation." },
  settings: { label: "Settings", description: "Workspace and product settings will be added after the dashboard foundation." },
};

export default async function DashboardPlaceholderPage({ params }: { params: Promise<{ section: string }> }) {
  const { workspace, product } = await getDashboardContext();
  const section = (await params).section;
  const content = sections[section] ?? { label: "Coming soon", description: "This dashboard area is not available yet." };
  return (
    <section className="dashboard-page dashboard-state">
      <p className="dashboard-eyebrow">{content.label}</p>
      <h1>{content.label} is taking shape.</h1>
      <p>{content.description}</p>
      <div className="dashboard-panel dashboard-context-summary"><span>Workspace</span><strong>{workspace?.name ?? "None selected"}</strong><span>Product</span><strong>{product?.name ?? "None selected"}</strong></div>
    </section>
  );
}
