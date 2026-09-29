import { getPublicShareCardQuery } from "@/server/modules/share-cards";
import { renderShareCardImage } from "../_lib/share-card-image";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getPublicShareCardQuery(slug);
  if (!card) return new Response("Share card unavailable", { status: 404 });
  return renderShareCardImage(card, "landscape", { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer" });
}
