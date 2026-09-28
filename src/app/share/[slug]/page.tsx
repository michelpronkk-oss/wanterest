import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ShareCardArtwork } from "@/components/share-cards/share-card-artwork";
import { ShareCardPublicActions, ShareCardOpenTracker } from "@/components/share-cards/share-card-public-actions";
import { getPublicShareCardQuery } from "@/server/modules/share-cards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getPublicShareCardQuery(slug);
  if (!card) return { title: "Share card unavailable", robots: { index: false, follow: false } };
  return {
    title: card.ogTitle,
    description: card.ogDescription,
    alternates: { canonical: card.canonicalUrl },
    robots: { index: false, follow: false },
    openGraph: { title: card.ogTitle, description: card.ogDescription, url: card.canonicalUrl, images: [{ url: `${card.canonicalUrl}/opengraph-image`, width: 1200, height: 630, alt: card.ogTitle }] },
    twitter: { card: "summary_large_image", title: card.ogTitle, description: card.ogDescription, images: [`${card.canonicalUrl}/opengraph-image`] },
  };
}

export default async function ShareCardPage({ params }: PageProps) {
  const { slug } = await params;
  const card = await getPublicShareCardQuery(slug);
  if (!card) notFound();
  return (
    <main className="share-card-page" aria-labelledby="share-card-title">
      <ShareCardOpenTracker publicSlug={card.publicSlug} />
      <div className="share-card-page-inner">
        <p className="marketing-content-eyebrow"><span className="marketing-content-eyebrow-dot" /> Wanterest shared identity</p>
        <h1 id="share-card-title">{card.identityLabel}{card.identityNumber ? ` ${card.identityNumber}` : ""}</h1>
        <p className="share-card-page-intro">A verified Wanterest identity, shared explicitly by its owner.</p>
        <div className="share-card-artwork-frame" aria-label={`${card.identityLabel} share card`}>
          <ShareCardArtwork data={card} />
        </div>
        <div className="share-card-page-details">
          <div>
            <span className="share-card-page-detail-label">{card.displayName ?? "Wanterest member"}</span>
            <span>{card.headline ?? "Shared with consent."}</span>
          </div>
          <Link className="dashboard-button dashboard-button-primary" href={card.ctaHref}>{card.ctaLabel} →</Link>
        </div>
        <ShareCardPublicActions publicSlug={card.publicSlug} canonicalUrl={card.canonicalUrl} title={card.ogTitle} />
        <p className="share-card-page-footnote">This card is not an invitation, access token, cohort assignment, or billing credential.</p>
      </div>
    </main>
  );
}
