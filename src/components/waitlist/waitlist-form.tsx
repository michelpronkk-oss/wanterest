"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { storePendingSubmission } from "./check-email-storage";

type FormState = "idle" | "sending" | "error";

const MAX_USE_CASE = 1200;

/**
 * The backend's public submission boundary intentionally returns the same {ok:true} response for
 * a new request, a duplicate pending request, a duplicate verified request, and a silently-dropped
 * honeypot hit — it must never become an email-enumeration oracle. So there is no distinct "already
 * applied" success state here: every accepted submission moves on to the same dedicated
 * /waitlist/check-email screen, and a genuinely new verification email only goes out when the
 * underlying row is still pending. The one truthful place "already verified" can show up is the
 * private status page, once someone with an existing session revisits it.
 *
 * On success this navigates to a dedicated screen rather than swapping in a local "success"
 * state, per the approved design: a genuine separate screen, not a state buried inside the
 * two-column landing page's form card, and one that survives a refresh (see
 * check-email-storage.ts for why sessionStorage, not this component's state, carries it).
 */
export function WaitlistForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledWebsite = normalizeWebsiteInput(searchParams.get("website") ?? "");

  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [contextOpen, setContextOpen] = useState(Boolean(prefilledWebsite));
  const [useCaseError, setUseCaseError] = useState(false);
  const [useCaseCount, setUseCaseCount] = useState(0);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const useCaseRef = useRef<HTMLTextAreaElement>(null);
  const firstNameId = useId(); const emailId = useId(); const companyId = useId(); const websiteId = useId(); const roleId = useId(); const useCaseId = useId(); const consentId = useId(); const honeypotId = useId();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || retryAfter > 0) return;

    const form = new FormData(event.currentTarget);
    const useCase = String(form.get("useCase") ?? "").trim();
    if (!useCase) {
      setUseCaseError(true);
      useCaseRef.current?.focus();
      return;
    }
    setUseCaseError(false);

    const params = new URLSearchParams(window.location.search);
    const utm = (key: string) => (params.get(key) ?? "").slice(0, 160);
    const email = String(form.get("email") ?? "");
    const payload = {
      firstName: form.get("firstName"), email, companyName: form.get("companyName"), companyWebsite: normalizeWebsiteInput(String(form.get("companyWebsite") ?? "")),
      roleTitle: form.get("roleTitle"), useCase, marketingConsent,
      honeypot: form.get("website"), source: utm("source") || "waitlist", utmSource: utm("utm_source"), utmMedium: utm("utm_medium"), utmCampaign: utm("utm_campaign"), utmContent: utm("utm_content"), utmTerm: utm("utm_term"),
      referrerCategory: document.referrer ? "external" : "direct", referralCode: utm("ref"),
    };

    setState("sending"); setErrorMessage("");
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string; details?: { retryAfterSeconds?: number } } } | null;
        setState("error");
        setErrorMessage(body?.error?.message ?? "We couldn't save that. Please try again.");
        if (body?.error?.details?.retryAfterSeconds) setRetryAfter(body.error.details.retryAfterSeconds);
        return;
      }
    } catch {
      setState("error");
      setErrorMessage("Wanterest isn't reachable right now. Please try again in a moment.");
      return;
    }
    storePendingSubmission(email, payload);
    router.push("/waitlist/check-email");
  }

  return (
    <form className="ea-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="ea-form-heading"><h2>Request access</h2><p>Four fields. Under a minute.</p></div>
      {state === "error" ? <p className="ea-form-error" role="alert">{retryAfter > 0 ? `${errorMessage} Try again in ${formatClock(retryAfter)}.` : errorMessage}</p> : null}
      <div className="ea-form-grid">
        <Field id={firstNameId} name="firstName" label="First name" required placeholder="Your first name" />
        <Field id={companyId} name="companyName" label="Company" required placeholder="Your company" />
      </div>
      <Field id={emailId} name="email" label="Work email" type="email" required placeholder="you@company.com" />

      <div className="ea-field">
        <label htmlFor={useCaseId}>What should Wanterest help you understand?</label>
        <textarea
          id={useCaseId}
          name="useCase"
          ref={useCaseRef}
          required
          rows={4}
          maxLength={MAX_USE_CASE}
          placeholder="Where our best-fit buyers are frustrated, and what they compare us against."
          onChange={(event) => { setUseCaseCount(event.target.value.length); if (useCaseError) setUseCaseError(false); }}
          aria-describedby={`${useCaseId}-count`}
          aria-invalid={useCaseError}
        />
        <div className="ea-field-meta" id={`${useCaseId}-count`}>{useCaseCount} / {MAX_USE_CASE}</div>
        {useCaseError ? <p className="ea-field-error" role="alert">Add a line here so we know what to review.</p> : null}
      </div>

      {!contextOpen ? (
        <button type="button" className="ea-context-teaser" onClick={() => setContextOpen(true)}>
          <span><strong>Add context</strong><small>Website and role. Optional, helps review.</small></span>
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
