"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { clearPendingSubmission, getPendingSubmissionSnapshot, getServerSnapshot, noopSubscribe } from "./check-email-storage";
import { resolveCheckEmailState } from "./journey";
import { StatusNotice } from "./journey-views";

type ResendState = "idle" | "sending" | "sent";
const RESEND_COOLDOWN_SECONDS = 60;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Best-effort convenience link only — never a claim about where the email actually is. */
function mailProvider(email: string): { url: string; label: string } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com") return { url: "https://mail.google.com/mail/u/0/#search/from%3Awanterest", label: "Open Gmail" };
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return { url: "https://outlook.live.com/mail/0/inbox", label: "Open Outlook" };
  return null;
}

/**
 * "Resend" replays the original request through the existing idempotent submission endpoint: for
 * a still-pending application the backend issues a fresh verification token and email (and the
 * previous link stops working). There is no separate resend operation to call.
 */
async function resubmit(payload: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string; retryAfterSeconds?: number }> {
  try {
    const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => null) as { error?: { message?: string; details?: { retryAfterSeconds?: number } } } | null;
    return { ok: false, message: body?.error?.message ?? "We couldn't send that. Please try again.", retryAfterSeconds: body?.error?.details?.retryAfterSeconds };
  } catch {
    return { ok: false, message: "Wanterest isn't reachable right now. Please try again in a moment." };
  }
}

function GenericCheckEmail() {
  return (
    <div className="ea-check-email">
      <div className="ea-check-email-pill"><span className="ea-check-email-dot" aria-hidden="true" />Early Access</div>
      <h1 id="check-email-title">Check your email.</h1>
      <p>If you just requested Early Access, a confirmation link is on its way. Open it to lock in your place.</p>
      <div className="ea-check-email-actions">
        <a className="dashboard-button dashboard-button-primary" href="/waitlist">Request access →</a>
      </div>
    </div>
  );
}

function AlreadyVerified({ email, earlyAccess }: { email: string; earlyAccess: string }) {
  return (
    <div className="ea-check-email">
      <div className="ea-check-email-pill is-verified"><span className="ea-check-email-dot" aria-hidden="true" />Verified</div>
      <h1 id="check-email-title">You&rsquo;re already verified.</h1>
      <p><strong>{email}</strong> is confirmed as Early Access <strong>{earlyAccess}</strong>. There&rsquo;s nothing left to confirm.</p>
      <div className="ea-check-email-actions">
        <a className="dashboard-button dashboard-button-primary" href="/waitlist/status">View status</a>
        <a className="dashboard-button dashboard-button-secondary" href="/waitlist/verified">See your Early Access identity</a>
      </div>
    </div>
  );
}

export function CheckEmailPanel({ verified }: { verified: { email: string; earlyAccess: string } | null }) {
  // Server snapshot is always null (there is no server-side session for a pre-verification
  // request — see check-email-storage.ts). useSyncExternalStore re-renders with the real client
  // snapshot right after hydration, safely, without a hydration-mismatch warning.
  const pending = useSyncExternalStore(noopSubscribe, getPendingSubmissionSnapshot, getServerSnapshot);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendError, setResendError] = useState<{ message: string; rateLimited: boolean } | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const state = resolveCheckEmailState(pending?.email ?? null, verified);
  if (state === "already_verified" && verified) return <AlreadyVerified email={verified.email} earlyAccess={verified.earlyAccess} />;
  if (state === "generic" || !pending) return <GenericCheckEmail />;

  const { email, payload } = pending;
  const mail = mailProvider(email);

  async function resend() {
    if (resendState === "sending" || resendCooldown > 0) return;
    setResendState("sending"); setResendError(null);
    const result = await resubmit({ ...payload, honeypot: "" });
    if (!result.ok) {
      setResendState("idle");
      setResendError({ message: result.message, rateLimited: Boolean(result.retryAfterSeconds) });
      if (result.retryAfterSeconds) setResendCooldown(result.retryAfterSeconds);
      return;
    }
    setResendState("sent");
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <div className="ea-check-email">
      <div className="ea-check-email-pill"><span className="ea-check-email-dot" aria-hidden="true" />Pending verification</div>
      <h1 id="check-email-title">You&rsquo;re on your way.</h1>
      <p>We sent a confirmation link to <strong>{email}</strong>. Confirm it to lock in your Early Access place.</p>
      <dl className="ea-check-email-list">
        <div><dt>Your number is set when you confirm</dt><dd>Not before.</dd></div>
        <div><dt>Then we review your request</dt><dd>Invites go out in waves.</dd></div>
        <div><dt>No dashboard access yet</dt><dd>Nothing is created until you are invited.</dd></div>
      </dl>
      <div className="ea-check-email-actions">
        {mail ? <a className="dashboard-button dashboard-button-primary" href={mail.url} target="_blank" rel="noopener noreferrer">{mail.label} {"↗︎"}</a> : null}
        <button type="button" className="dashboard-button dashboard-button-secondary" disabled={resendState === "sending" || resendCooldown > 0} onClick={() => void resend()}>
          {resendCooldown > 0 ? `Resend in ${formatClock(resendCooldown)}` : resendState === "sending" ? "Sending…" : "Resend email"}
        </button>
      </div>
      {resendState === "sent" ? <StatusNotice tone="positive" title="Sent again" body={<>A new link is on its way to {email}. The previous one no longer works.</>} /> : null}
      {resendError?.rateLimited && resendCooldown > 0 ? <StatusNotice tone="warning" title="Too many attempts" body={<>For your security, resends are limited. You can resend in {formatClock(resendCooldown)}.</>} /> : null}
      {resendError && !resendError.rateLimited ? <StatusNotice tone="error" title="We couldn't send that" body={resendError.message} /> : null}
      <p className="ea-check-email-recovery">Wrong address? <a href="/waitlist" onClick={() => clearPendingSubmission()}>Start again</a>.</p>
    </div>
  );
}
