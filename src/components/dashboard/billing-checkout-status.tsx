"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CheckoutState = "idle" | "pending" | "active" | "processing" | "cancelled";

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 25_000;

export function BillingCheckoutStatus({ workspaceId, initialPlan, state }: { workspaceId: string; initialPlan: "free" | "pro" | "growth"; state?: string }) {
  const router = useRouter();
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(state === "cancelled" ? "cancelled" : state === "success" ? "pending" : "idle");
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (state !== "success" || initialPlan !== "free") return;
    let cancelled = false;
    const startedAt = Date.now();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/billing/overview?workspace_id=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const body = await response.json() as { overview?: { effectivePlan?: string; subscription?: { status?: string | null } | null } };
        const overview = body.overview;
        const paidStatus = ["active", "trialing", "past_due", "canceling"].includes(overview?.subscription?.status ?? "");
        if (overview && overview.effectivePlan && overview.effectivePlan !== initialPlan && paidStatus) {
          if (!cancelled) {
            setCheckoutState("active");
            if (!refreshedRef.current) {
              refreshedRef.current = true;
              router.refresh();
            }
          }
          return;
        }
      } catch {
        // Keep the pending state; a transient read failure is not a payment failure.
      }
      if (cancelled) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setCheckoutState("processing");
        return;
      }
      timeout = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [initialPlan, router, state, workspaceId]);

  if (checkoutState === "idle") return null;
  if (checkoutState === "cancelled") return <div className="billing-checkout-notice" role="status">Checkout cancelled. Your current plan has not changed.</div>;
  if (checkoutState === "active") return <div className="billing-checkout-notice" role="status">Your plan is active. Wanterest is updating your access now.</div>;
  if (checkoutState === "processing") return <div className="billing-checkout-notice" role="status">Your payment is processing. Your plan will unlock automatically once confirmed.</div>;
  return <div className="billing-checkout-notice" role="status" aria-live="polite">Payment received. Confirming your subscription…</div>;
}
