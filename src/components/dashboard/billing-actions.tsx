"use client";

import { useState } from "react";

import { UpgradeTrigger, type UpgradePlan } from "./upgrade-surface";

type BillingActionsProps = {
  workspaceId: string;
  currentPlan: UpgradePlan;
};

export function BillingActions({ workspaceId, currentPlan }: BillingActionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const body = await response.json() as { portalUrl?: string; error?: { message?: string } };
      if (!response.ok || !body.portalUrl) throw new Error(body.error?.message ?? "The billing portal is not available yet.");
      window.location.assign(body.portalUrl);
    } catch (value) {
      setError(value instanceof Error ? value.message : "The billing portal is not available yet.");
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {currentPlan === "free" ? <UpgradeTrigger workspaceId={workspaceId} currentPlan={currentPlan} label="Upgrade plan" /> : (
          <>
            <button type="button" className="dashboard-button dashboard-button-primary" onClick={() => void openPortal()} disabled={busy}>
              {busy ? "Opening portal…" : "Manage subscription"}
            </button>
            {currentPlan === "pro" ? <UpgradeTrigger workspaceId={workspaceId} currentPlan={currentPlan} plan="growth" label="Upgrade to Growth" variant="secondary" /> : null}
          </>
        )}
      </div>
      {error ? <p role="alert" style={{ color: "var(--color-danger, #a33)", fontSize: 12, marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
