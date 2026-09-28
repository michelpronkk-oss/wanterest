"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type FormState = "idle" | "sending" | "success" | "error";
type ResendState = "idle" | "sending" | "sent";

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_USE_CASE = 1200;

/**
 * The backend's public submission boundary intentionally returns the same {ok:true} response for
 * a new request, a duplicate pending request, a duplicate verified request, and a silently-dropped
 * honeypot hit — it must never become an email-enumeration oracle. So there is no distinct "already
 * applied" success state here: every accepted submission shows the same confirmation, and a
 * genuinely new verification email only goes out when the underlying row is still pending. The
 * one truthful place "already verified" can show up is the private status page, once someone with
 * an existing session revisits it.
 */
export function WaitlistForm() {
  const searchParams = useSearchParams();
  const prefilledWebsite = normalizeWebsiteInput(searchParams.get("website") ?? "");

  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [contextOpen, setContextOpen] = useState(Boolean(prefilledWebsite));
  const [contextPrompt, setContextPrompt] = useState(false);
  const [useCaseCount, setUseCaseCount] = useState(0);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendError, setResendError] = useState("");
  const [confirmedEmail, setConfirmedEmail] = useState("");

  const useCaseRef = useRef<HTMLTextAreaElement>(null);
  const firstNameId = useId(); const emailId = useId(); const companyId = useId(); const websiteId = useId(); const roleId = useId(); const useCaseId = useId(); const consentId = useId(); const honeypotId = useId();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function post(payload: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string; retryAfterSeconds?: number }> {
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (response.ok) return { ok: true };
      const body = await response.json().catch(() => null) as { error?: { message?: string; details?: { retryAfterSeconds?: number } } } | null;
      return { ok: false, message: body?.error?.message ?? "We couldn't save that. Please try again.", retryAfterSeconds: body?.error?.details?.retryAfterSeconds };
    } catch {
      return { ok: false, message: "Wanterest isn't reachable right now. Please try again in a moment." };
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || retryAfter > 0) return;

    const form = new FormData(event.currentTarget);
    const useCase = String(form.get("useCase") ?? "").trim();
    if (!useCase) {
      setContextOpen(true);
      setContextPrompt(true);
      window.requestAnimationFrame(() => useCaseRef.current?.focus());
      return;
    }
    setContextPrompt(false);

    const params = new URLSearchParams(window.location.search);
    const utm = (key: string) => (params.get(key) ?? "").slice(0, 160);
    const payload = {
      firstName: form.get("firstName"), email: form.get("email"), companyName: form.get("companyName"), companyWebsite: normalizeWebsiteInput(String(form.get("companyWebsite") ?? "")),
      roleTitle: form.get("roleTitle"), useCase, marketingConsent,
      honeypot: form.get("website"), source: utm("source") || "waitlist", utmSource: utm("utm_source"), utmMedium: utm("utm_medium"), utmCampaign: utm("utm_campaign"), utmContent: utm("utm_content"), utmTerm: utm("utm_term"),
      referrerCategory: document.referrer ? "external" : "direct", referralCode: utm("ref"),
    };

    setState("sending"); setErrorMessage("");
    const result = await post(payload);
    if (!result.ok) {
      setState("error");
      setErrorMessage(result.message);
      if (result.retryAfterSeconds) setRetryAfter(result.retryAfterSeconds);
      return;
    }
    setConfirmedEmail(String(payload.email ?? ""));
    setLastPayload(payload);
    setState("success");
  }

  async function resend() {
    if (!lastPayload || resendState === "sending" || resendCooldown > 0) return;
    setResendState("sending"); setResendError("");
    const result = await post({ ...lastPayload, honeypot: "" });
    if (!result.ok) {
      setResendState("idle");
      setResendError(result.message);
      return;
    }
    setResendState("sent");
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  if (state === "success") {
    return (
      <div className="ea-check-email" role="status">
        <div className="ea-check-email-pill"><span className="ea-check-email-dot" aria-hidden="true" />Pending verification</div>
        <h2>You&rsquo;re on your way.</h2>
        <p>We sent a confirmation link to <strong>{confirmedEmail}</strong>. Confirm it to lock in your Early Access place.</p>
        <dl className="ea-check-email-list">
          <div><dt>Your number is set when you confirm</dt><dd>Not before.</dd></div>
          <div><dt>Then we review your request</dt><dd>Invites go out in waves.</dd></div>
          <div><dt>No dashboard access yet</dt><dd>Nothing is created until you are invited.</dd></div>
        </dl>
        <div className="ea-check-email-actions">
          <button type="button" className="dashboard-button dashboard-button-secondary" disabled={resendState === "sending" || resendCooldown > 0} onClick={() => void resend()}>
            {resendCooldown > 0 ? `Resend in ${formatClock(resendCooldown)}` : resendState === "sending" ? "Sending…" : resendState === "sent" ? "Sent again" : "Resend email"}
          </button>
        </div>
        {resendState === "sent" && resendCooldown > 0 ? <p className="ea-check-email-note">A new link is on its way to {confirmedEmail}. The previous one no longer works.</p> : null}
        {resendError ? <p className="ea-form-error" role="alert">{resendError}</p> : null}
      </div>
    );
  }

  return (
    <form className="ea-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="ea-form-heading"><h2>Request access</h2><p>Three fields. Under a minute.</p></div>
      {state === "error" ? <p className="ea-form-error" role="alert">{retryAfter > 0 ? `${errorMessage} Try again in ${formatClock(retryAfter)}.` : errorMessage}</p> : null}
      <div className="ea-form-grid">
        <Field id={firstNameId} name="firstName" label="First name" required placeholder="Your first name" />
        <Field id={companyId} name="companyName" label="Company" required placeholder="Your company" />
      </div>
      <Field id={emailId} name="email" label="Work email" type="email" required placeholder="you@company.com" />

      {!contextOpen ? (
        <button type="button" className="ea-context-teaser" onClick={() => setContextOpen(true)}>
          <span><strong>Add context</strong><small>Website, role, what you want to learn. Optional, helps review.</small></span>
          <span className="ea-context-teaser-plus" aria-hidden="true">+</span>
        </button>
      ) : (
        <div className="ea-context">
          <div className="ea-context-head">
            <span>Context</span>
            <button type="button" className="ea-context-hide" onClick={() => setContextOpen(false)}>Hide</button>
          </div>
          <Field id={websiteId} name="companyWebsite" label="Website" optional placeholder="yourcompany.com" defaultValue={prefilledWebsite} />
          <Field id={roleId} name="roleTitle" label="Role" optional placeholder="Founder, Head of growth…" />
          <div className="ea-field">
            <label htmlFor={useCaseId}>What should Wanterest help you understand?</label>
            <textarea
              id={useCaseId}
              name="useCase"
              ref={useCaseRef}
              rows={4}
              maxLength={MAX_USE_CASE}
              placeholder="Where our best-fit buyers are frustrated, and what they compare us against."
              onChange={(event) => setUseCaseCount(event.target.value.length)}
              aria-describedby={`${useCaseId}-count`}
            />
            <div className="ea-field-meta" id={`${useCaseId}-count`}>{useCaseCount} / {MAX_USE_CASE}</div>
            {contextPrompt ? <p className="ea-field-error">Add a line here so we know what to review.</p> : null}
          </div>
        </div>
      )}

      <label className="ea-checkbox"><input id={consentId} type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /> <span>Send me occasional product updates. Optional.</span></label>
      <div className="ea-honeypot" aria-hidden="true"><label htmlFor={honeypotId}>Website</label><input id={honeypotId} name="website" tabIndex={-1} autoComplete="off" /></div>
      <button className="dashboard-button dashboard-button-primary ea-submit" type="submit" disabled={state === "sending" || retryAfter > 0}>
        {state === "sending" ? "Saving your request" : "Request Early Access →"}
      </button>
      <p className="ea-form-legal">We&rsquo;ll email you once to confirm. This doesn&rsquo;t create an account.</p>
    </form>
  );
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Matches the site-wide convention (see marketing/links.ts) of accepting a bare domain and treating it as https. The real schema still has the final word server-side. */
function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function Field({ id, name, label, type = "text", required = false, optional = false, placeholder, defaultValue }: { id: string; name: string; label: string; type?: string; required?: boolean; optional?: boolean; placeholder?: string; defaultValue?: string }) {
  return (
    <div className="ea-field">
      <label htmlFor={id}>{label}{optional ? <span className="ea-field-optional">Optional</span> : null}</label>
      <input id={id} name={name} type={type} required={required} maxLength={240} placeholder={placeholder} defaultValue={defaultValue} />
    </div>
  );
}
