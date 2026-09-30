"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { storePendingSubmission } from "./check-email-storage";
import {
  buildWaitlistPayload,
  MAX_USE_CASE,
  normalizeWebsiteInput,
  REQUIRED_FIELD_ORDER,
  requiredFieldErrors,
  submitWaitlistRequest,
  websiteLabel,
  type RequiredField,
} from "./waitlist-form-model";

type FormState = "idle" | "sending" | "error";

/**
 * The backend's public submission boundary intentionally returns the same {ok:true} response for
 * a new request, a duplicate pending request, a duplicate verified request, and a silently-dropped
 * honeypot hit — it must never become an email-enumeration oracle. So there is no distinct "already
 * applied" success state here: every accepted submission moves on to the same dedicated
 * /waitlist/check-email screen, and a genuinely new verification email only goes out when the
 * underlying row is still pending.
 *
 * On success this navigates to a dedicated screen rather than swapping in a local "success"
 * state, and one that survives a refresh (see check-email-storage.ts for why sessionStorage, not
 * this component's state, carries it).
 *
 * Layout (F1.4): the four required fields are always visible; website, role and product-updates
 * consent sit in a collapsed "Add context" section whose inputs stay mounted, so a website
 * prefilled from the homepage is still submitted while collapsed.
 */
export function WaitlistForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledWebsite = normalizeWebsiteInput(searchParams.get("website") ?? "");

  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredField, string>>>({});
  const [useCaseCount, setUseCaseCount] = useState(0);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [applicationStartedTracked, setApplicationStartedTracked] = useState(false);

  const ids = {
    firstName: useId(), companyName: useId(), email: useId(), useCase: useId(),
    website: useId(), role: useId(), consent: useId(), panel: useId(), honeypot: useId(),
  };

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  function clearFieldError(field: RequiredField) {
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || retryAfter > 0) return;

    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const values = {
      firstName: text("firstName"), companyName: text("companyName"), email: text("email"), useCase: text("useCase"),
      companyWebsite: text("companyWebsite"), roleTitle: text("roleTitle"), marketingConsent, honeypot: text("website"),
    };

    const errors = requiredFieldErrors(values);
    setFieldErrors(errors);
    const firstInvalid = REQUIRED_FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalid) {
      document.getElementById(ids[firstInvalid])?.focus();
      return;
    }

    const payload = buildWaitlistPayload(values, window.location.search, document.referrer);
    setState("sending"); setErrorMessage("");
    const result = await submitWaitlistRequest(payload);
    if (!result.ok) {
      setState("error");
      setErrorMessage(result.message);
      if (result.retryAfterSeconds) setRetryAfter(result.retryAfterSeconds);
      return;
    }
    storePendingSubmission(values.email, payload);
    router.push("/waitlist/check-email");
  }

  return (
    <form className="ea-form" onFocusCapture={() => {
      if (applicationStartedTracked) return;
      setApplicationStartedTracked(true);
      track("application_started");
    }} onSubmit={(event) => void submit(event)} noValidate>
      <div className="ea-form-heading"><h2>Request access</h2><p>Takes under a minute.</p></div>
      {state === "error" ? <p className="ea-form-error" role="alert">{retryAfter > 0 ? `${errorMessage} Try again in ${formatClock(retryAfter)}.` : errorMessage}</p> : null}

      <div className="ea-form-grid">
        <Field id={ids.firstName} name="firstName" label="First name" autoComplete="given-name" placeholder="Your first name" error={fieldErrors.firstName} onInput={() => clearFieldError("firstName")} />
        <Field id={ids.companyName} name="companyName" label="Company" autoComplete="organization" placeholder="Your company" error={fieldErrors.companyName} onInput={() => clearFieldError("companyName")} />
      </div>
      <Field id={ids.email} name="email" label="Work email" type="email" autoComplete="email" placeholder="you@company.com" error={fieldErrors.email} onInput={() => clearFieldError("email")} />

      <div className="ea-field">
        <div className="ea-field-label-row">
          <label htmlFor={ids.useCase}>What should Wanterest help you understand?</label>
          <span className="ea-field-meta" id={`${ids.useCase}-count`}>{useCaseCount} / {MAX_USE_CASE}</span>
        </div>
        <textarea
          id={ids.useCase}
          name="useCase"
          required
          rows={2}
          maxLength={MAX_USE_CASE}
          placeholder="Where our best-fit buyers are frustrated, and what they compare us against."
          onChange={(event) => { setUseCaseCount(event.target.value.length); clearFieldError("useCase"); }}
          aria-describedby={fieldErrors.useCase ? `${ids.useCase}-count ${ids.useCase}-error` : `${ids.useCase}-count`}
          aria-invalid={Boolean(fieldErrors.useCase)}
        />
        {fieldErrors.useCase ? <p className="ea-field-error" id={`${ids.useCase}-error`} role="alert">{fieldErrors.useCase}</p> : null}
      </div>

      <OptionalContext
        open={contextOpen}
        onToggle={() => setContextOpen((open) => !open)}
        ids={{ panel: ids.panel, website: ids.website, role: ids.role, consent: ids.consent }}
        prefilledWebsite={prefilledWebsite}
        marketingConsent={marketingConsent}
        onConsentChange={setMarketingConsent}
      />

      <div className="ea-honeypot" aria-hidden="true"><label htmlFor={ids.honeypot}>Website</label><input id={ids.honeypot} name="website" tabIndex={-1} autoComplete="off" /></div>
      <button className="ea-submit" type="submit" disabled={state === "sending" || retryAfter > 0}>
        {state === "sending" ? "Saving your request" : <>Request Early Access<span className="ea-submit-arrow" aria-hidden="true">→</span></>}
      </button>
      <p className="ea-form-legal">We&rsquo;ll email you once to confirm. This doesn&rsquo;t create an account.</p>
    </form>
  );
}

/**
 * "+ Add context (optional)". Collapsed by default; the panel is hidden, never unmounted, so its
 * values (including a homepage-prefilled website) are always part of the submission. Marketing
 * consent lives here, unchecked by default and independent of the request itself.
 */
export function OptionalContext({ open, onToggle, ids, prefilledWebsite, marketingConsent, onConsentChange }: {
  open: boolean;
  onToggle: () => void;
  ids: { panel: string; website: string; role: string; consent: string };
  prefilledWebsite: string;
  marketingConsent: boolean;
  onConsentChange: (value: boolean) => void;
}) {
  const summary = prefilledWebsite ? `${websiteLabel(prefilledWebsite)} added` : "Website, role, product updates";
  return (
    <div className={`ea-optional${open ? " is-open" : ""}`}>
      <button type="button" className="ea-optional-toggle" aria-expanded={open} aria-controls={ids.panel} onClick={onToggle}>
        <span className="ea-optional-icon" aria-hidden="true" />
        <span className="ea-optional-label">Add context <span>(optional)</span></span>
        <span className="ea-optional-summary">{summary}</span>
      </button>
      <div id={ids.panel} className="ea-optional-panel" hidden={!open}>
        <div className="ea-form-grid">
          <Field id={ids.website} name="companyWebsite" label="Company website" optional inputMode="url" autoComplete="url" placeholder="yourcompany.com" defaultValue={prefilledWebsite} />
          <Field id={ids.role} name="roleTitle" label="Role" optional autoComplete="organization-title" placeholder="Founder, Head of growth…" />
        </div>
        <label className="ea-checkbox" htmlFor={ids.consent}>
          <input id={ids.consent} type="checkbox" checked={marketingConsent} onChange={(event) => onConsentChange(event.target.checked)} />
          <span>Send me occasional product updates. Optional, and separate from your request.</span>
        </label>
      </div>
    </div>
  );
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Field({ id, name, label, type = "text", optional = false, placeholder, defaultValue, autoComplete, inputMode, error, onInput }: {
  id: string; name: string; label: string; type?: string; optional?: boolean; placeholder?: string; defaultValue?: string;
  autoComplete?: string; inputMode?: "url" | "email" | "text"; error?: string; onInput?: () => void;
}): ReactNode {
  return (
    <div className="ea-field">
      <label htmlFor={id}>{label}{optional ? <span className="ea-field-optional">Optional</span> : null}</label>
      <input
        id={id}
        name={name}
        type={type}
        required={!optional}
        maxLength={240}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onInput={onInput}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? <p className="ea-field-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}
