"use client";

import { useState } from "react";

export function WaitlistWithdrawButton() {
  const [state, setState] = useState<"idle" | "confirm" | "sending" | "done">("idle");
  async function withdraw() {
    setState("sending");
    const response = await fetch("/api/waitlist/withdraw", { method: "POST" });
    setState(response.ok ? "done" : "idle");
  }
  if (state === "done") return <p className="waitlist-withdrawn" role="status">Your request has been withdrawn. Your historical Early Access number remains reserved.</p>;
  if (state === "confirm") return <div className="waitlist-withdraw-confirm"><p>Withdraw this request? It will no longer be eligible for admission.</p><button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => setState("idle")}>Keep request</button><button className="dashboard-button dashboard-button-primary" type="button" onClick={() => void withdraw()}>Withdraw request</button></div>;
  return <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => setState("confirm")}>Withdraw request</button>;
}
