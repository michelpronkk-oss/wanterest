import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { ShareCardPreview } from "@/components/share-cards/share-card-preview";
import { ShareCardPublicActions, ShareCardOpenTracker } from "@/components/share-cards/share-card-public-actions";
import { getPublicShareCardQuery } from "@/server/modules/share-cards";
import { shareCardLine, shareCardTitle } from "@/shared/share-card-presentation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getPublicShareCardQuery(slug).catch(() => null);
  if (!card) return { title: "Share card unavailable", robots: { index: false, follow: false } };
  return {
    title: { absolute: card.ogTitle },
    description: card.ogDescription,
    alternates: { canonical: card.canonicalUrl },
    robots: { index: false, follow: false },
    openGraph: { title: card.ogTitle, description: card.ogDescription, url: card.canonicalUrl, images: [{ url: `${card.canonicalUrl}/opengraph-image`, width: 1200, height: 630, alt: card.ogTitle }] },
    twitter: { card: "summary_large_image", title: card.ogTitle, description: card.ogDescription, images: [`${card.canonicalUrl}/opengraph-image`] },
  };
}

/** Public, noindex landing page for a consented share card: the card, what it means, one CTA. */
export default async function ShareCardPage({ params }: PageProps) {
  const { slug } = await params;
  const card = await getPublicShareCardQuery(slug).catch(() => null);
  if (!card) notFound();
  const title = shareCardTitle(card.variant, card.identityNumber);
  const cohort = card.variant === "FOUNDING_25" || card.variant === "EARLY_100";
  return (
    <MarketingPageShell>
      <main className="share-card-page" aria-labelledby="share-card-title">
        <ShareCardOpenTracker publicSlug={card.publicSlug} />
        <div className="share-card-page-inner">
          <p className="share-card-page-eyebrow"><span aria-hidden="true" />Shared by its owner</p>
          <h1 id="share-card-title">{cohort && card.displayName ? `${card.displayName} · ${title}` : title}</h1>
          <p className="share-card-page-intro">{shareCardLine(card.variant, card.identityNumber)} Wanterest finds real buying intent in public conversations, with the source behind every signal.</p>
          {/* Wide card on desktop; the square cut on phones, where the wide one gets too small to read. */}
          <div className="share-card-page-card is-landscape"><ShareCardPreview data={card} label={`${title} share card`} /></div>
          <div className="share-card-page-card is-square"><ShareCardPreview data={card} format="square" label={`${title} share card`} /></div>
          <div className="share-card-page-actions">
            <Link className="dashboard-button dashboard-button-primary" href={card.ctaHref}>{card.ctaLabel}<span aria-hidden="true"> →</span></Link>
            <ShareCardPublicActions publicSlug={card.publicSlug} canonicalUrl={card.canonicalUrl} title={card.ogTitle} />
          </div>
          <p className="share-card-page-footnote">Published with the owner&rsquo;s consent. This card isn&rsquo;t an invitation, access token, cohort assignment or billing credential.</p>
        </div>
      </main>
    </MarketingPageShell>
  );
}
