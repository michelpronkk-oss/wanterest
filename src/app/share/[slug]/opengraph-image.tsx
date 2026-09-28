import { ImageResponse } from "next/og";

import { ShareCardArtwork } from "@/components/share-cards/share-card-artwork";
import { getPublicShareCardQuery } from "@/server/modules/share-cards";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getPublicShareCardQuery(slug);
  if (!card) return new Response("Share card unavailable", { status: 404 });
  return new ImageResponse(<ShareCardArtwork data={card} />, {
    width: size.width,
    height: size.height,
    headers: { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer" },
  });
}
