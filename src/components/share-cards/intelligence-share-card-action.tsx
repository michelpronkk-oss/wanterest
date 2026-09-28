"use client";

import { ShareCardPanel, type ShareCardPanelCard } from "./share-card-panel";

type IntelligenceShareCardActionProps = {
  endpoint: string;
  card: ShareCardPanelCard;
  title?: string;
};

/** A detail-scoped sharing control; it does not load a dashboard-wide card collection. */
export function IntelligenceShareCardAction({ endpoint, card, title = "Share this evidence-backed insight" }: IntelligenceShareCardActionProps) {
  return <ShareCardPanel endpoint={endpoint} initialCards={[card]} title={title} />;
}

export type { IntelligenceShareCardActionProps };
