"use client";

import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";

import { requestAccessUrlForSite, startUrlForSite } from "./links";

const TYPING_EXAMPLES = ["linear.app", "notion.so", "figma.com", "yourcompany.io"];

/** Cycles the input's placeholder through a few example sites once it's empty and idle. */
function useTypingPlaceholder(defaultText: string, enabled: boolean): string {
  const [display, setDisplay] = useState(defaultText);

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const words = [defaultText, ...TYPING_EXAMPLES];
    let wordIndex = 0;
    let charIndex = defaultText.length;
    let deleting = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    function tick() {
      const word = words[wordIndex];
      charIndex = deleting ? Math.max(0, charIndex - 1) : Math.min(word.length, charIndex + 1);
      setDisplay(word.slice(0, charIndex));

      if (deleting && charIndex === 0) {
        deleting = false;
        wordIndex = (wordIndex + 1) % words.length;
        timeoutId = setTimeout(tick, 300);
        return;
      }
      if (!deleting && charIndex === word.length) {
        deleting = true;
        timeoutId = setTimeout(tick, 1600);
        return;
      }
      timeoutId = setTimeout(tick, deleting ? 40 : 70);
    }

    timeoutId = setTimeout(tick, 1600);
    return () => clearTimeout(timeoutId);
  }, [defaultText, enabled]);

  return display;
}

/**
 * "scan" drives the existing OPEN-mode entry (public signup, via /start). "request" is the
 * WAITLIST/INVITE_ONLY entry: same URL field, but it hands off to /waitlist with the site
 * prefilled instead of implying instant product access — see the design note this replaces
 * ("'Scan my website' reads as a site audit, and implies instant access").
 */
function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="marketing-hero-field-icon">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.6 3.8 2.6 6.2S9.8 12.5 8 14.2C6.2 12.5 5.4 10.4 5.4 8S6.2 3.5 8 1.8Z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * `appearance="hero"` is the Hero v2 treatment: field and ink button share one white container,
 * with the lime arrow. Submission, validation and destinations are identical in both appearances.
 */
export function ScanForm({ compact = false, ctaVariant = "ink", variant = "scan", appearance = "default" }: { compact?: boolean; ctaVariant?: "ink" | "accent"; variant?: "scan" | "request"; appearance?: "default" | "hero" }) {
  const errorId = useId();
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const defaultPlaceholder = compact || variant === "request" ? "yourcompany.com" : "yourwebsite.com";
  const placeholder = useTypingPlaceholder(defaultPlaceholder, site.length === 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError(null);
      window.location.href = variant === "request" ? requestAccessUrlForSite(site) : startUrlForSite(site);
    } catch {
      setError("Enter a valid public website, like linear.app.");
    }
  }

  const inputProps = {
    type: "text",
    inputMode: "url" as const,
    autoComplete: "off",
    placeholder,
    "aria-label": "Your website",
    value: site,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setSite(event.target.value);
      if (error) setError(null);
    },
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? errorId : undefined,
  };
  const errorMessage = error ? <p id={errorId} className="marketing-scan-error" role="alert">{error}</p> : null;

  if (appearance === "hero") {
    return (
      <form className="marketing-hero-form" onSubmit={handleSubmit}>
        <div className="marketing-hero-form-box">
          <label className="marketing-hero-field">
            <GlobeIcon />
            <input {...inputProps} className="marketing-hero-input" />
          </label>
          <button type="submit" className="marketing-hero-submit">
            {variant === "request" ? "Request access" : "Scan my website"}
            <span className="marketing-hero-arrow" aria-hidden="true">→</span>
          </button>
        </div>
        {errorMessage}
      </form>
    );
  }

  return (
    <form className={`marketing-scan-form${compact ? " is-compact" : ""}`} onSubmit={handleSubmit}>
      <input {...inputProps} className="marketing-scan-input" />
      <button type="submit" className={`marketing-cta${compact ? " is-compact" : ""}${ctaVariant === "accent" ? " is-accent" : ""}`}>
        {variant === "request" ? "Request access →" : "Scan my website →"}
      </button>
      {errorMessage}
    </form>
  );
}
