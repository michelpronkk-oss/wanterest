import { recordShareCardEventCommand } from "@/server/modules/share-cards";
import { readJson } from "@/server/lib/http";
import { isKnownShareCrawler } from "@/server/modules/share-cards/share-card.analytics";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (isKnownShareCrawler(request.headers.get("user-agent"))) {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  try {
    await recordShareCardEventCommand(await readJson(request));
  } catch {
    // Distribution analytics are best effort and never gate a public share page.
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
