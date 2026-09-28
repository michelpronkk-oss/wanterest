import { ImageResponse } from "next/og";

import { ShareCardArtwork } from "@/components/share-cards/share-card-artwork";
import { getPublicShareCardQuery } from "@/server/modules/share-cards";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const card = await getPublicShareCardQuery(slug);
  if (!card) return new Response("Share card unavailable", { status: 404 });
  const format = new URL(request.url).searchParams.get("format");
  const dimensions = format === "square" ? { width: 1080, height: 1080 } : { width: 1080, height: 1350 };
  return new ImageResponse(<ShareCardArtwork data={card} />, {
    ...dimensions,
    headers: { "cache-control": "no-store, max-age=0", "content-disposition": `attachment; filename="wanterest-${card.variant.toLowerCase()}-${format === "square" ? "square" : "portrait"}.png"`, "referrer-policy": "no-referrer" },
  });
}
