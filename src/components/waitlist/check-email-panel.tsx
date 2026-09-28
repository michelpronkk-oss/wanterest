"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { clearPendingSubmission, getPendingSubmissionSnapshot, getServerSnapshot, noopSubscribe } from "./check-email-storage";

type ResendState = "idle" | "sending" | "sent";
const RESEND_COOLDOWN_SECONDS = 60;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Best-effort convenience link only — never a claim about where the email actually is. */
function mailProviderUrl(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com") return "https://mail.google.com/mail/u/0/#search/from%3Awanterest";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return "https://outlook.live.com/mail/0/inbox";
  return null;
}

async function submitToWaitlist(payload: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "We couldn't send that. Please try again." };
  } catch {
    return { ok: false, message: "Wanterest isn't reachable right now. Please try again in a moment." };
  }
}

/** The "no data at all" case: a fresh tab, cleared storage, or someone navigating here directly. Never fabricates an email or a pending state. */
function GenericCheckEmail() {
  return (
    <div className="ea-check-email">
      <div className="ea-check-email-pill"><span className="ea-check-email-dot" aria-hidden="true" />Early Access</div>
      <h1>Check your email.</h1>
      <p>If you just requested Early Access, a confirmation link is on its way. Open it to lock in your place.</p>
      <div className="ea-check-email-actions">
        <a className="dashboard-button dashboard-button-primary" href="/waitlist">Request access →</a>
      </div>
    </div>
  );
}

export function CheckEmailPanel() {
  // Server snapshot is always null (there is no server-side session for a pre-verification
  // request — see check-email-storage.ts). useSyncExternalStore re-renders with the real client
  // snapshot right after hydration, safely, without a hydration-mismatch warning.
  const pending = useSyncExternalStore(noopSubscribe, getPendingSubmissionSnapshot, getServerSnapshot);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendError, setResendError] = useState("");

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function resend() {
    if (!pending || resendState === "sending" || resendCooldown > 0) return;
    setResendState("sending"); setResendError("");
    const result = await submitToWaitlist({ ...pending.payload, honeypot: "" });
    if (!result.ok) {
      setResendState("idle");
      setResendError(result.message);
      return;
    }
    setResendState("sent");
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  if (!pending) return <GenericCheckEmail />;
  const { email } = pending;
  const mailUrl = mailProviderUrl(email);

  return (
    <div className="ea-check-email">
      <div className="ea-check-email-pill"><span className="ea-check-email-dot" aria-hidden="true" />Pending verification</div>
      <h1>You&rsquo;re on your way.</h1>
      <p>We sent a confirmation link to <strong>{email}</strong>. Confirm it to lock in your Early Access place.</p>
      <dl className="ea-check-email-list">
        <div><dt>Your number is set when you confirm</dt><dd>Not before.</dd></div>
        <div><dt>Then we review your request</dt><dd>Invites go out in waves.</dd></div>
        <div><dt>No dashboard access yet</dt><dd>Nothing is created until you are invited.</dd></div>
      </dl>
      <div className="ea-check-email-actions">
        {mailUrl ? <a className="dashboard-button dashboard-button-primary" href={mailUrl} target="_blank" rel="noopener noreferrer">Open email ↗</a> : null}
        <button type="button" className="dashboard-button dashboard-button-secondary" disabled={resendState === "sending" || resendCooldown > 0} onClick={() => void resend()}>
          {resendCooldown > 0 ? `Resend in ${formatClock(resendCooldown)}` : resendState === "sending" ? "Sending…" : resendState === "sent" ? "Sent again" : "Resend email"}
        </button>
      </div>
      {resendState === "sent" && resendCooldown > 0 ? <p className="ea-check-email-note">A new link is on its way to {email}. The previous one no longer works.</p> : null}
      {resendError ? <p className="ea-form-error" role="alert">{resendError}</p> : null}
      <p className="ea-check-email-recovery">Wrong address? <a href="/waitlist" onClick={() => clearPendingSubmission()}>Start again</a>.</p>
    </div>
  );
}
