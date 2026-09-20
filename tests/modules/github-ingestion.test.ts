import { describe, expect, it, vi } from "vitest";

import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { GitHubSourceAdapter } from "../../src/server/providers/source/github";
import { githubIssue, githubIssueComment, githubIssueSearchResponse } from "../../src/server/providers/source/github/fixtures";

function response(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

describe("GitHub ingestion pipeline", () => {
  it("stores raw issue/comment envelopes and replays without network access", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...githubIssueSearchResponse, items: [githubIssue] }))
      .mockResolvedValueOnce(response([githubIssueComment]));
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([["github", new GitHubSourceAdapter({ fetchImpl })]]));

    const discovery = await service.discoverSource("github", {
      query: "export",
      limit: 1,
      expandThreads: true,
      requestMetadata: { maxComments: 1, maxCommentPages: 1 },
    });
    expect(discovery.rawInserted).toBe(2);
    expect(repository.rawItems.size).toBe(2);
    const callsAfterDiscovery = fetchImpl.mock.calls.length;

    const replay = await service.replay({ sourceKey: "github", normalizationVersion: "github-v1", canonicalizationVersion: "canonical-v1" });
    expect(fetchImpl).toHaveBeenCalledTimes(callsAfterDiscovery);
    expect(replay).toMatchObject({ rawItems: 2, normalized: 2, canonicalized: 2, failed: 0 });
    expect(repository.sourceItems.size).toBe(2);
    expect(repository.conversations.size).toBe(1);
    expect(repository.conversationSourceItems).toHaveLength(2);
    expect(repository.provenance.length).toBeGreaterThanOrEqual(4);
    expect([...repository.conversations.values()][0]?.conversation_key).toContain("github:issue:9001:42");
  });
});

