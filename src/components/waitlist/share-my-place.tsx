"use client";

import { useState } from "react";

import { ShareCardPanel, type ShareCardPanelCard } from "@/components/share-cards/share-card-panel";

/**
 * The applicant share endpoint must live under /waitlist: the private status cookie is scoped to
 * path=/waitlist, so a browser never sends it to /api/share-cards/applicant.
 */
export const APPLICANT_SHARE_ENDPOINT = "/waitlist/share-cards";

export type ShareAvailability = { available: true; cards: ShareCardPanelCard[] } | { available: false };

function ShareUnavailable() {
  return (
    <div className="ea-notice is-neutral" role="status">
      <span className="ea-notice-dot" aria-hidden="true" />
      <div>
        <strong>Sharing isn&rsquo;t available right now</strong>
        <p>Your Early Access number is safe. Only public share cards are affected — nothing is published without your explicit choice.</p>
      </div>
    </div>
  );
}

/** Existing Layer 13B.1 panel: preview is private until the applicant explicitly publishes. */
export function ShareSection({ share }: { share: ShareAvailability }) {
  if (!share.available) return <ShareUnavailable />;
  return <ShareCardPanel endpoint={APPLICANT_SHARE_ENDPOINT} initialCards={share.cards} title="Share your place" />;
}

export function RevealActions({ share }: { share: ShareAvailability }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="ea-reveal-actions">
        <a className="dashboard-button dashboard-button-primary" href="/waitlist/status">View status</a>
        <button type="button" className="dashboard-button dashboard-button-secondary" aria-expanded={open} aria-controls="share-my-place" onClick={() => setOpen((value) => !value)}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10V2M4.8 5.2 8 2l3.2 3.2M3 9v4h10V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Share my place
        </button>
      </div>
      <div id="share-my-place" className="ea-reveal-share" hidden={!open}>
        {open ? <ShareSection share={share} /> : null}
      </div>
    </>
  );
}
