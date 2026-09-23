"use client";

import { useState } from "react";

type BillingActionsProps = {
  workspaceId: string;
  paid: boolean;
};

export function BillingActions({ workspaceId, paid }: BillingActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openCheckout(plan: "pro" | "growth") {
    setBusy(plan);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, plan, interval: "monthly", idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json() as { checkoutUrl?: string; error?: { message?: string } };
      if (!response.ok || !body.checkoutUrl) throw new Error(body.error?.message ?? "Checkout could not be started.");
      window.location.assign(body.checkoutUrl);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Checkout could not be started.");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
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
      setBusy(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {paid ? (
          <button type="button" className="dashboard-button dashboard-button-primary" onClick={openPortal} disabled={busy !== null}>
            {busy === "portal" ? "Opening portal…" : "Manage subscription"}
          </button>
        ) : (
          <>
            <button type="button" className="dashboard-button dashboard-button-primary" onClick={() => openCheckout("pro")} disabled={busy !== null}>
              {busy === "pro" ? "Opening checkout…" : "Upgrade to Pro"}
            </button>
            <button type="button" className="dashboard-button" onClick={() => openCheckout("growth")} disabled={busy !== null}>
              {busy === "growth" ? "Opening checkout…" : "Upgrade to Growth"}
            </button>
          </>
        )}
      </div>
      {error ? <p role="alert" style={{ color: "var(--color-danger, #a33)", fontSize: 12, marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
