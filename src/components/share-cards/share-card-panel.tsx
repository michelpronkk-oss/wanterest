"use client";

import { useMemo, useState } from "react";

import { shareCardTitle } from "@/shared/share-card-presentation";
import { ShareCardPreview } from "./share-card-preview";

type ShareCardPanelCard = {
  variant: "EARLY_ACCESS" | "PRIORITY_ACCESS" | "FOUNDING_25" | "EARLY_100";
  displayName: string | null;
  headline: string | null;
  identityLabel: string;
  identityNumber: number | null;
  tone: "neutral" | "priority" | "founding" | "early";
  isPermanent: boolean;
  monogram: string | null;
  admittedOn: string | null;
  publicationId: string | null;
  publicSlug: string | null;
  publicationState: "published" | "revoked" | null;
  publishedAt: string | null;
};

const variantOrder: ShareCardPanelCard["variant"][] = ["FOUNDING_25", "EARLY_100", "PRIORITY_ACCESS", "EARLY_ACCESS"];

function event(publicSlug: string, eventType: "shared" | "downloaded", source: "copy" | "x" | "linkedin" | "download") {
  void fetch("/api/share-cards/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicSlug, eventType, source }), keepalive: true });
}

function DownloadIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8M4.8 6.8 8 10l3.2-3.2M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/**
 * Private share controls (Board 15 artwork). Nothing is public until "Publish" — an explicit,
 * per-card consent — and "Unpublish" removes the public link. `endpoint` is the owner-scoped
 * mutation route (applicant: /waitlist/share-cards; workspace: /api/share-cards/workspace/:id).
 */
export function ShareCardPanel({ endpoint, initialCards, title = "Share your Wanterest identity", compact = false }: { endpoint: string; initialCards: ShareCardPanelCard[]; title?: string; compact?: boolean }) {
  const [cards, setCards] = useState(initialCards);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "positive" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const orderedCards = useMemo(() => [...cards].sort((a, b) => variantOrder.indexOf(a.variant) - variantOrder.indexOf(b.variant)), [cards]);

  function publicUrl(card: ShareCardPanelCard) {
    return `${window.location.origin}/share/${encodeURIComponent(card.publicSlug!)}`;
  }

  function shareExternally(card: ShareCardPanelCard, network: "x" | "linkedin") {
    if (!card.publicSlug) return;
    const url = publicUrl(card);
    const href = network === "x"
      ? `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${shareCardTitle(card.variant, card.identityNumber)} · Wanterest`)}`
      : `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    window.open(href, "_blank", "noopener,noreferrer");
    event(card.publicSlug, "shared", network);
  }

  async function mutate(card: ShareCardPanelCard, action: "publish" | "revoke") {
    setBusy(`${card.variant}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, variant: card.variant }) });
      const payload = await response.json() as { card?: ShareCardPanelCard; cards?: ShareCardPanelCard[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "The share card could not be updated.");
      if (payload.card) setCards((current) => current.map((item) => item.variant === card.variant ? payload.card! : item));
      if (payload.cards) setCards(payload.cards);
      setMessage({ tone: "positive", text: action === "publish" ? "Published. Anyone with the link can now see this card." : "Unpublished. The public link no longer works." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The share card could not be updated." });
    } finally {
      setBusy(null);
    }
  }

  async function copy(card: ShareCardPanelCard) {
    if (!card.publicSlug) return;
    try {
      await navigator.clipboard.writeText(publicUrl(card));
      setCopied(card.variant);
      event(card.publicSlug, "shared", "copy");
      window.setTimeout(() => setCopied(null), 2200);
    } catch {
      setMessage({ tone: "error", text: "Copying the link isn't available in this browser." });
    }
  }

  return (
    <section className={`share-card-panel${compact ? " is-compact" : ""}`} aria-labelledby="share-card-panel-title">
      <div className="share-card-panel-heading">
        <h2 id="share-card-panel-title">{title}</h2>
        <p>Private until you publish. Publishing creates a link anyone can open; unpublish any time.</p>
      </div>
      {message ? <p className={`share-card-panel-message is-${message.tone}`} role="status">{message.text}</p> : null}
      {orderedCards.length === 0 ? <p className="share-card-panel-empty">No share cards yet. Your card appears here once your Early Access number is verified or your cohort seat is confirmed.</p> : null}
      <div className="share-card-panel-grid">
        {orderedCards.map((card) => {
          const published = card.publicationState === "published" && card.publicSlug;
          const title = shareCardTitle(card.variant, card.identityNumber);
          return (
            <article className="share-card-panel-card" key={card.variant}>
              <ShareCardPreview data={card} label={`${title} share card preview`} />
              <div className="share-card-panel-card-body">
                <div className="share-card-panel-card-copy">
                  <strong>{title}</strong>
                  <span className={published ? "is-live" : undefined}><i aria-hidden="true" />{published ? "Public" : "Private"} · {card.isPermanent ? "Permanent identity" : "Current status"}</span>
                </div>
                <div className="share-card-panel-controls">
                  {!published ? (
                    <button className="dashboard-button dashboard-button-primary" type="button" disabled={busy !== null} onClick={() => void mutate(card, "publish")}>
                      {busy === `${card.variant}:publish` ? "Publishing…" : card.publicationState === "revoked" ? "Publish again" : "Publish card"}
                    </button>
                  ) : (
                    <>
                      <button className="dashboard-button dashboard-button-primary" type="button" onClick={() => void copy(card)}>{copied === card.variant ? "Link copied" : "Copy link"}</button>
                      <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => shareExternally(card, "x")}>Post on X</button>
                      <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => shareExternally(card, "linkedin")}>LinkedIn</button>
                      <a className="dashboard-button dashboard-button-secondary" href={`/share/${encodeURIComponent(card.publicSlug!)}/image?format=portrait`} download onClick={() => event(card.publicSlug!, "downloaded", "download")}><DownloadIcon />Portrait</a>
                      <a className="dashboard-button dashboard-button-secondary" href={`/share/${encodeURIComponent(card.publicSlug!)}/image?format=square`} download onClick={() => event(card.publicSlug!, "downloaded", "download")}><DownloadIcon />Square</a>
                      <button className="share-card-panel-unpublish" type="button" disabled={busy !== null} onClick={() => void mutate(card, "revoke")}>{busy === `${card.variant}:revoke` ? "Unpublishing…" : "Unpublish"}</button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export type { ShareCardPanelCard };
