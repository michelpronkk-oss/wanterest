import { getPublicShareCardQuery } from "@/server/modules/share-cards";
import { renderShareCardImage, shareCardFormat } from "../../_lib/share-card-image";

export const runtime = "nodejs";

/** Download image: ?format=portrait (1080×1350, default) | square (1080×1080) | landscape (1200×630). */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const card = await getPublicShareCardQuery(slug);
  if (!card) return new Response("Share card unavailable", { status: 404 });
  const format = shareCardFormat(new URL(request.url).searchParams.get("format"));
  return renderShareCardImage(card, format, {
    "cache-control": "no-store, max-age=0",
    "content-disposition": `attachment; filename="wanterest-${card.variant.toLowerCase().replace("_", "-")}-${format}.png"`,
    "referrer-policy": "no-referrer",
  });
}
