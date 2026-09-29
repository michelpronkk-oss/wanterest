import { recordShareCardEventCommand } from "@/server/modules/share-cards";
import { readJson } from "@/server/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await recordShareCardEventCommand(await readJson(request));
  } catch {
    // Distribution analytics are best effort and never gate a public share page.
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
