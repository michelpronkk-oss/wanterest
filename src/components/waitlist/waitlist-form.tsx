"use client";

import { useId, useState, type FormEvent } from "react";

type FormState = "idle" | "sending" | "success" | "error";

export function WaitlistForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const firstNameId = useId(); const emailId = useId(); const companyId = useId(); const websiteId = useId(); const roleId = useId(); const useCaseId = useId(); const consentId = useId(); const honeypotId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || state === "success") return;
    setState("sending"); setMessage("");
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams(window.location.search);
    const value = (key: string) => (params.get(key) ?? "").slice(0, 160);
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        firstName: form.get("firstName"), email: form.get("email"), companyName: form.get("companyName"), companyWebsite: form.get("companyWebsite"), roleTitle: form.get("roleTitle"), useCase: form.get("useCase"), marketingConsent,
        honeypot: form.get("website"), source: value("source") || "waitlist", utmSource: value("utm_source"), utmMedium: value("utm_medium"), utmCampaign: value("utm_campaign"), utmContent: value("utm_content"), utmTerm: value("utm_term"), referrerCategory: document.referrer ? "external" : "direct",
      }) });
      if (!response.ok) throw new Error("submit_failed");
      setState("success");
    } catch {
      setState("error"); setMessage("We couldn’t save that request. Please try again in a moment.");
    }
  }

  if (state === "success") return <div className="waitlist-success" role="status"><div className="waitlist-success-mark" aria-hidden="true">✓</div><h2>You&rsquo;re on the Wanterest Early Access list.</h2><p>Check your inbox to confirm your request. Your Early Access number is finalized only after verification.</p><p className="waitlist-success-note">No dashboard access has been granted yet.</p></div>;

  return (
    <form className="waitlist-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="waitlist-form-heading"><div className="marketing-content-eyebrow">REQUEST ACCESS</div><h2>A little context helps.</h2><p>Two minutes now means a more useful first conversation later.</p></div>
      {state === "error" ? <p className="waitlist-form-error" role="alert">{message}</p> : null}
      <div className="waitlist-form-grid">
        <Field id={firstNameId} name="firstName" label="First name" required placeholder="Your first name" />
        <Field id={emailId} name="email" label="Work email" type="email" required placeholder="you@company.com" />
        <Field id={companyId} name="companyName" label="Company" required placeholder="Your company" />
        <Field id={websiteId} name="companyWebsite" label="Company website" placeholder="https://example.com" />
        <Field id={roleId} name="roleTitle" label="Role" placeholder="Product, marketing, founder…" />
      </div>
      <div className="waitlist-field"><label htmlFor={useCaseId}>What do you want Wanterest to help you understand?</label><textarea id={useCaseId} name="useCase" rows={5} maxLength={1200} required placeholder="For example: where our best-fit buyers are frustrated and what they compare us against." /></div>
      <label className="waitlist-checkbox"><input id={consentId} type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /> <span>I&rsquo;d like to receive occasional Wanterest updates. This is optional.</span></label>
      <div className="waitlist-honeypot" aria-hidden="true"><label htmlFor={honeypotId}>Website</label><input id={honeypotId} name="website" tabIndex={-1} autoComplete="off" /></div>
      <button className="dashboard-button dashboard-button-primary waitlist-submit" type="submit" disabled={state === "sending"}>{state === "sending" ? "Saving your request…" : "Request Early Access"}</button>
      <p className="waitlist-form-legal">Transactional email is used only to confirm your request and share status. Marketing updates are separate and optional.</p>
    </form>
  );
}

function Field({ id, name, label, type = "text", required = false, placeholder }: { id: string; name: string; label: string; type?: string; required?: boolean; placeholder?: string }) { return <div className="waitlist-field"><label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label><input id={id} name={name} type={type} required={required} maxLength={type === "url" ? 240 : 160} placeholder={placeholder} /></div>; }
