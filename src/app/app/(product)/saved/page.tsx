import Link from "next/link";

import { SignalList } from "@/components/dashboard/signal-list";
import { ZeroState } from "@/components/ui/zero-state";
import { SavedGhostPreview } from "@/components/dashboard/saved-ghost-preview";
import { getDashboardContext } from "@/server/modules/dashboard/dashboard.context";
import { listSignalsQuery } from "@/server/modules/intelligence/commands";

const SAVED_TITLE = "Keep the demand signals worth coming back to.";
const SAVED_BODY = "Saved Signals give you a focused place to revisit evidence, buyer language, switching intent, and important market conversations.";

export default async function SavedPage() {
  const context = await getDashboardContext();

  if (!context.workspace) {
    return <section className="dashboard-page dashboard-state"><p className="dashboard-eyebrow">Saved</p><h1>Create a workspace first</h1><Link className="dashboard-button dashboard-button-primary" href="/app/setup/workspace">Create workspace</Link></section>;
  }
  if (!context.product) {
    return (
      <section className="dashboard-page">
        <ZeroState eyebrow="Saved" title={SAVED_TITLE} body={SAVED_BODY} align="narrow" primaryCta={{ label: "Add product", href: "/app/setup/product" }} />
        <SavedGhostPreview />
      </section>
    );
  }

  const { workspace, product } = context;
  const savedSignals = await listSignalsQuery(workspace.id, product.id, { lifecycleStatus: "saved", limit: 50 });

  return (
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <p className="dashboard-eyebrow">Saved</p>
        <h1>Saved</h1>
        <p className="dashboard-subtitle">{SAVED_TITLE}</p>
      </header>

      {savedSignals.length === 0 ? (
        <>
          <ZeroState
            title="Nothing saved yet."
            body="Save a signal from your feed to build a focused research shortlist here."
            align="narrow"
            primaryCta={{ label: "Browse Signals", href: "/app/signals" }}
          />
          <SavedGhostPreview />
        </>
      ) : (
        <SignalList signals={savedSignals} workspaceId={workspace.id} showNote />
      )}
    </section>
  );
}
