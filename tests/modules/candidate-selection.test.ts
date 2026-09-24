import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { selectScanCandidates } from "../../src/server/modules/onboarding/initial-scan.service";

describe("candidate selection v2", () => {
  it("is stable when Supabase returns the same rows in a different order", () => {
    const sources = ["github", "hacker-news", "x"];
    const conversations = Array.from({ length: 25 }, (_, index) => ({ id: `conversation-${index}`, primary_source_item_id: `source-${index}`, published_at: "2026-01-01T00:00:00.000Z" } as ConversationRow));
    const sourceById = new Map(conversations.map((conversation, index) => {
      const source = sources[index < 13 ? 0 : index < 19 ? 1 : 2];
      const row = { id: conversation.primary_source_item_id, source_key: source, title: `Demand ${index}`, body: `A detailed ${source} demand conversation ${index} with distinct evidence.`, metadata: { query: "market demand" } } as unknown as SourceItemRow;
      return [conversation.primary_source_item_id, row];
    }));
    const first = selectScanCandidates({ conversations, sourceById, max: 15 });
    const shuffled = selectScanCandidates({ conversations: [...conversations].reverse(), sourceById, max: 15 });

    expect(first.conversations.map((item) => item.id)).toEqual(shuffled.conversations.map((item) => item.id));
    expect(first.diagnostics).toEqual(shuffled.diagnostics);
    expect(first.diagnostics.selectedCount).toBe(15);
    expect(first.diagnostics.selectedBySource).toMatchObject({ github: expect.any(Number), "hacker-news": expect.any(Number), x: expect.any(Number) });
  });
});
