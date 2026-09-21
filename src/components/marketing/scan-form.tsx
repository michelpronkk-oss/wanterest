"use client";

import { useState, type FormEvent } from "react";

import { signupUrlForSite } from "./links";

export function ScanForm({ compact = false }: { compact?: boolean }) {
  const [site, setSite] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.href = signupUrlForSite(site);
  }

  return (
    <form className={`marketing-scan-form${compact ? " is-compact" : ""}`} onSubmit={handleSubmit}>
      <input
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder={compact ? "yourcompany.com" : "yourwebsite.com"}
        aria-label="Your website"
        className="marketing-scan-input"
        value={site}
        onChange={(event) => setSite(event.target.value)}
      />
      <button type="submit" className={`marketing-cta${compact ? " is-compact" : ""}`}>
        Scan my website →
      </button>
    </form>
  );
}
