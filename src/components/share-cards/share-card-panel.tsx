"use client";

import { useMemo, useState } from "react";

import { ShareCardArtwork, shareCardIdentity } from "./share-card-artwork";

type ShareCardPanelCard = {
  variant: "EARLY_ACCESS" | "PRIORITY_ACCESS" | "FOUNDING_25" | "EARLY_100";
  displayName: string | null;
  headline: string | null;
  identityLabel: string;
  identityNumber: number | null;
  tone: "neutral" | "priority" | "founding" | "early";
  isPermanent: boolean;
  publicationId: string | null;
  publicSlug: string | null;
  publicationState: "published" | "revoked" | null;
  publishedAt: string | null;
};

const variantOrder: ShareCardPanelCard["variant"][] = ["EARLY_ACCESS", "PRIORITY_ACCESS", "FOUNDING_25", "EARLY_100"];

function publishLabel(card: ShareCardPanelCard): string {
  if (card.publicationState === "revoked") return "Share again";
  return "Share publicly";
}

function event(publicSlug: string, eventType: "shared" | "downloaded", source: "copy" | "x" | "linkedin" | "download") {
  void fetch("/api/share-cards/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicSlug, eventType, source }), keepalive: true });
}

export function ShareCardPanel({ endpoint, initialCards, title = "Share your Wanterest identity" }: { endpoint: string; initialCards: ShareCardPanelCard[]; title?: string }) {
  const [cards, setCards] = useState(initialCards);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const orderedCards = useMemo(() => [...cards].sort((a, b) => variantOrder.indexOf(a.variant) - variantOrder.indexOf(b.variant)), [cards]);

  function shareExternally(card: ShareCardPanelCard, network: "x" | "linkedin") {
    if (!card.publicSlug) return;
    const publicUrl = `${window.location.origin}/share/${encodeURIComponent(card.publicSlug)}`;
    const href = network === "x"
      ? `https://twitter.com/intent/tweet?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(`${card.identityLabel} · Wanterest`)}`
      : `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicUrl)}`;
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
      if (action === "publish" && payload.card) setCards((current) => current.map((item) => item.variant === card.variant ? payload.card! : item));
      if (action === "revoke" && payload.cards) setCards(payload.cards);
      setMessage(action === "publish" ? "The card is now public." : "The share link was unpublished.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The share card could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function copy(card: ShareCardPanelCard) {
    if (!card.publicSlug) return;
    const url = `${window.location.origin}/share/${encodeURIComponent(card.publicSlug)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(card.variant);
      event(card.publicSlug, "shared", "copy");
      window.setTimeout(() => setCopied(null), 2200);
    } catch {
      setMessage("Copying the link was not available in this browser.");
    }
  }

  return (
    <section className="share-card-panel" aria-labelledby="share-card-panel-title">
      <div className="share-card-panel-heading">
        <div><div className="ui-section-label">Public identity</div><h2 id="share-card-panel-title">{title}</h2></div>
        <p>Preview is private until you explicitly publish a card.</p>
      </div>
      {message ? <p className="share-card-panel-message" role="status">{message}</p> : null}
      {orderedCards.length === 0 ? <p className="share-card-panel-empty">No eligible share cards are available yet. Verified Early Access and authoritative membership status appear here when they are earned.</p> : null}
      <div className="share-card-panel-grid">
        {orderedCards.map((card) => {
          const published = card.publicationState === "published" && card.publicSlug;
          return (
            <article className="share-card-panel-card" key={card.variant}>
              <div className="share-card-panel-artwork"><ShareCardArtwork data={card} /></div>
              <div className="share-card-panel-card-copy"><div><strong>{card.identityLabel} {shareCardIdentity(card)}</strong><span>{card.isPermanent ? "Permanent identity" : "Current status"}</span></div></div>
              <div className="share-card-panel-controls">
                {!published ? <button className="dashboard-button dashboard-button-primary" type="button" disabled={busy !== null} onClick={() => void mutate(card, "publish")}>{busy === `${card.variant}:publish` ? "Publishing…" : publishLabel(card)}</button> : <>
                  <button className="dashboard-button dashboard-button-secondary" type="button" disabled={busy !== null} onClick={() => void copy(card)}>{copied === card.variant ? "Link copied" : "Copy link"}</button>
                  <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => shareExternally(card, "x")}>X</button>
                  <button className="dashboard-button dashboard-button-secondary" type="button" onClick={() => shareExternally(card, "linkedin")}>LinkedIn</button>
                  <a className="dashboard-button dashboard-button-secondary" href={`/share/${encodeURIComponent(card.publicSlug!)}/image?format=portrait`} download onClick={() => event(card.publicSlug!, "downloaded", "download")}>Download</a>
                  <button className="dashboard-button dashboard-button-danger" type="button" disabled={busy !== null} onClick={() => void mutate(card, "revoke")}>{busy === `${card.variant}:revoke` ? "Unpublishing…" : "Unpublish"}</button>
                </>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export type { ShareCardPanelCard };
