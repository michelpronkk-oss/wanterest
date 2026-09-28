"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Posts to /waitlist/withdraw: the private status cookie (path=/waitlist) is never sent to /api/*. */
const WITHDRAW_ENDPOINT = "/waitlist/withdraw";

export function WaitlistWithdrawButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "sending" | "done" | "failed">("idle");
  async function withdraw() {
    setState("sending");
    try {
      const response = await fetch(WITHDRAW_ENDPOINT, { method: "POST" });
      if (!response.ok) throw new Error("withdraw_failed");
      setState("done");
      // Re-read the authoritative status so the page shows the real withdrawn state.
      router.refresh();
    } catch {
      setState("failed");
    }
  }
  if (state === "done") return <p className="waitlist-withdrawn" role="status">Your request has been withdrawn. Your historical Early Access number remains reserved.</p>;
  if (state === "confirm" || state === "sending" || state === "failed") {
    return (
      <div className="waitlist-withdraw-confirm">
        <p>{state === "failed" ? "We couldn't withdraw your request. Please try again." : "Withdraw this request? It will no longer be eligible for admission."}</p>
        <button className="dashboard-button dashboard-button-secondary" type="button" disabled={state === "sending"} onClick={() => setState("idle")}>Keep request</button>
        <button className="dashboard-button dashboard-button-danger" type="button" disabled={state === "sending"} onClick={() => void withdraw()}>{state === "sending" ? "Withdrawing…" : "Withdraw request"}</button>
      </div>
    );
  }
  return <button className="ea-text-action is-destructive" type="button" onClick={() => setState("confirm")}>Withdraw request</button>;
}
