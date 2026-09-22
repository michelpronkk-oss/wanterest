"use client";

import { useEffect, useState, type FormEvent } from "react";

import { startUrlForSite } from "./links";

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

export function ScanForm({ compact = false }: { compact?: boolean }) {
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const defaultPlaceholder = compact ? "yourcompany.com" : "yourwebsite.com";
  const placeholder = useTypingPlaceholder(defaultPlaceholder, site.length === 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError(null);
      window.location.href = startUrlForSite(site);
    } catch {
      setError("Enter a valid public website, like linear.app.");
    }
  }

  return (
    <form className={`marketing-scan-form${compact ? " is-compact" : ""}`} onSubmit={handleSubmit}>
      <input
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder={placeholder}
        aria-label="Your website"
        className="marketing-scan-input"
        value={site}
        onChange={(event) => {
          setSite(event.target.value);
          if (error) setError(null);
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "marketing-site-error" : undefined}
      />
      <button type="submit" className={`marketing-cta${compact ? " is-compact" : ""}`}>
        Scan my website →
      </button>
      {error ? <p id="marketing-site-error" className="marketing-scan-error" role="alert">{error}</p> : null}
    </form>
  );
}
