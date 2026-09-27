import { describe, expect, it, vi } from "vitest";

import { InMemoryIngestionRepository } from "../../src/server/modules/ingestion/in-memory.repository";
import { IngestionService } from "../../src/server/modules/ingestion/ingestion.service";
import { toSourceDiscoveryRequest } from "../../src/server/modules/operations/query-planning.execution";
import { DiscourseSourceAdapter, normalizeDiscourseInstance } from "../../src/server/providers/source/discourse";
import { evaluateDiscourseDepth, selectDiscoursePosts } from "../../src/server/providers/source/discourse/discourse-depth";

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const topic = {
  id: 42,
  slug: "looking-for-a-better-planner",
  title: "Looking for a better planning workflow",
  excerpt: "We need a tool that makes planning less manual.",
  posts_count: 5,
  category_id: 7,
  category_name: "Productivity",
  tags: ["workflow", "recommendation"],
  created_at: "2025-01-02T10:00:00.000Z",
  updated_at: "2026-09-26T10:00:00.000Z",
  bumped_at: "2026-09-26T10:00:00.000Z",
  user: { username: "alice", user_id: 9, name: "Alice" },
  accepted_answer_post_id: 45,
};

const posts = [
  { id: 44, post_number: 1, username: "alice", user_id: 9, cooked: "<p>We <strong>need</strong> a planning tool because our workflow is manual.</p>", raw: "We need a planning tool because our workflow is manual.", created_at: "2025-01-02T10:00:00.000Z", updated_at: "2026-09-26T10:00:00.000Z", like_count: 2, topic_id: 42, topic_slug: topic.slug },
  { id: 45, post_number: 2, username: "bob", user_id: 10, cooked: "<p>Our team switched from the old tool; this alternative is simpler.</p>", raw: "Our team switched from the old tool; this alternative is simpler.", created_at: "2025-01-03T10:00:00.000Z", reply_to_post_number: 1, like_count: 8, topic_id: 42, topic_slug: topic.slug, accepted_answer: true },
  { id: 46, post_number: 3, username: "helper_bot", user_id: 11, cooked: "<p>Automated release announcement</p>", raw: "Automated release announcement", created_at: "2025-01-04T10:00:00.000Z", reply_to_post_number: 1, like_count: 100, user: { user_type: "bot" }, topic_id: 42, topic_slug: topic.slug },
  { id: 47, post_number: 4, username: "carol", user_id: 12, cooked: "<pre>Traceback: stack trace</pre>", raw: "Traceback: stack trace", created_at: "2025-01-05T10:00:00.000Z", reply_to_post_number: 2, like_count: 20, topic_id: 42, topic_slug: topic.slug },
  { id: 48, post_number: 5, username: "alice", user_id: 9, cooked: "<p>Thanks, I would like to know how migration works.</p>", raw: "Thanks, I would like to know how migration works.", created_at: "2025-01-06T10:00:00.000Z", reply_to_post_number: 2, like_count: 1, topic_id: 42, topic_slug: topic.slug },
];

function adapterWithFetch(fetchImpl: typeof fetch = vi.fn<typeof fetch>()) {
  return new DiscourseSourceAdapter({ baseUrl: "https://forum.example.test", fetchImpl, clock: () => new Date("2026-09-27T00:00:00.000Z") });
}

describe("Discourse Depth V1", () => {
  it("normalizes instances without merging independent domains", () => {
    expect(normalizeDiscourseInstance("FORUM.Example.test/")) .toBe("https://forum.example.test");
    expect(normalizeDiscourseInstance("https://forum.example.test/community/")) .toBe("https://forum.example.test/community");
    expect(normalizeDiscourseInstance("http://forum.example.test")).toBeNull();
  });

  it("discovers topics, hydrates bounded posts, and emits source telemetry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/search.json")) return response({ topics: [topic], more_topics_url: null });
      if (url.includes("/t/looking-for-a-better-planner/42.json")) return response({ ...topic, post_stream: { posts, stream: posts.map((post) => post.id) } });
      throw new Error(`unexpected URL ${url}`);
    });
    const adapter = adapterWithFetch(fetchImpl);
    const page = await adapter.discover({ query: "planning workflow", limit: 25, expandThreads: false, requestMetadata: { discourseInstance: "https://forum.example.test", queryPlanVersion: "query_planning_v8", depthPolicyVersion: "discourse_depth_v1", maxPages: 2, maxPostsPerTopic: 4 } });

    expect(page.items.map((item) => item.externalId)).toEqual([
      "discourse:https://forum.example.test:topic:42",
      "discourse:https://forum.example.test:topic:42:post:45",
      "discourse:https://forum.example.test:topic:42:post:48",
    ]);
    expect(page.items.slice(1).every((item) => item.cursorContext.rootExternalId === page.items[0]?.externalId)).toBe(true);
    expect(page.providerMetrics).toMatchObject({ discourseDepthV1: { policyVersion: "discourse_depth_v1", searchRoots: 1, depthEligible: 1, depthExpanded: 1, depthRequests: 1, postsLoaded: 5, postsPersisted: 3 } });
    expect(fetchImpl.mock.calls.every(([, init]) => !(init?.headers as Record<string, string> | undefined)?.Authorization)).toBe(true);
  });

  it("keeps overlapping identifiers distinct across instances", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/search.json")) return response({ topics: [{ ...topic, posts_count: 2 }] });
      if (url.includes("/t/looking-for-a-better-planner/42.json")) return response({ ...topic, posts_count: 2, post_stream: { posts: posts.slice(0, 2) } });
      throw new Error(`unexpected URL ${url}`);
    });
    const adapter = new DiscourseSourceAdapter({ fetchImpl, clock: () => new Date("2026-09-27T00:00:00.000Z") });
    const page = await adapter.discover({ query: "planning", limit: 2, expandThreads: false, requestMetadata: { discourseInstances: ["https://one.example.test", "https://two.example.test"], depthPolicyVersion: "discourse_depth_v1" } });
    expect(new Set(page.items.map((item) => item.externalId))).toEqual(new Set([
      "discourse:https://one.example.test:topic:42",
      "discourse:https://one.example.test:topic:42:post:45",
      "discourse:https://two.example.test:topic:42",
      "discourse:https://two.example.test:topic:42:post:45",
    ]));
  });

  it("canonicalizes a topic and selected replies into one conversation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).includes("/search.json")
      ? response({ topics: [topic], more_topics_url: null })
      : response({ ...topic, post_stream: { posts } }));
    const adapter = adapterWithFetch(fetchImpl);
    const repository = new InMemoryIngestionRepository();
    const service = new IngestionService(repository, new Map([[adapter.key, adapter]]));
    const discovered = await service.discoverSource("discourse", { query: "planning", limit: 3, expandThreads: false, requestMetadata: { depthPolicyVersion: "discourse_depth_v1" } });
    for (const raw of repository.rawItems.values()) {
      const normalized = await service.normalizeRawSourceItem(raw.id, "discourse-v1");
      await service.canonicalizeSourceItem(normalized.sourceItemId, "canonical-v1");
    }
    expect(discovered.rawInserted).toBe(3);
    expect(repository.sourceItems.size).toBe(3);
    expect(repository.conversations.size).toBe(1);
    expect(new Set([...repository.sourceItems.values()].map((item) => item.external_conversation_id))).toEqual(new Set(["discourse:https://forum.example.test:topic:42"]));
  });

  it("skips unchanged topics during an incremental refresh", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ topics: [{ ...topic, bumped_at: "2025-01-01T00:00:00.000Z" }] }));
    const page = await adapterWithFetch(fetchImpl).discover({ query: "planning", limit: 3, expandThreads: false, windowStart: "2026-01-01T00:00:00.000Z", requestMetadata: { depthPolicyVersion: "discourse_depth_v1" } });
    expect(page.items).toHaveLength(0);
    expect(page.providerMetrics).toMatchObject({ discourseDepthV1: { refreshSkips: 1, depthRequests: 0 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("handles public rate limiting as a bounded skip", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ error: "rate limited" }, 429, { "retry-after": "2" }));
    const page = await adapterWithFetch(fetchImpl).discover({ query: "planning", limit: 3, expandThreads: false, requestMetadata: { depthPolicyVersion: "discourse_depth_v1" } });
    expect(page.items).toHaveLength(0);
    expect(page.providerMetrics).toMatchObject({ discourseDepthV1: { rateLimitSkips: 1 } });
  });

  it("applies deterministic demand/noise eligibility and reply selection", () => {
    expect(evaluateDiscourseDepth({ title: "Moderator release announcement", postsCount: 3 })).toMatchObject({ eligible: false, reason: "moderation" });
    expect(evaluateDiscourseDepth({ title: "How do I configure the plugin?", body: "Stack trace and error log", postsCount: 4 })).toMatchObject({ eligible: false });
    expect(evaluateDiscourseDepth({ title: "Feature request: better workflow", postsCount: 2 })).toMatchObject({ eligible: true });
    expect(selectDiscoursePosts({ posts: posts.map((post) => ({ id: post.id, postNumber: post.post_number, body: post.cooked, username: post.username, authorType: post.user?.user_type, replyToPostNumber: post.reply_to_post_number, createdAt: post.created_at, likeCount: post.like_count })), acceptedPostId: 45, maxPosts: 3 }).map((post) => post.id)).toEqual([44, 45, 48]);
  });

  it.each([
    ["how do I configure X?", "Configuration steps only", undefined, false],
    ["plugin installation error", "The install failed with an exception", undefined, false],
    ["stack trace", "Traceback: error log", undefined, false],
    ["Moderator announcement", "Please read the release notes", undefined, false],
    ["Release notes", "A changelog for this month", undefined, false],
    ["System maintenance", "Automated maintenance notice", "bot", false],
    ["Feature request: export workflow", "We need this capability", undefined, true],
    ["Should we switch from the old tool?", "Looking for alternatives", undefined, true],
    ["What alternatives are people using?", "Recommend a replacement", undefined, true],
    ["Pricing and purchase question", "What does adoption cost?", undefined, true],
    ["Repeated workflow pain", "Our manual workflow is slow", undefined, true],
    ["Historical demand thread", "In 2019 we needed a better tool", undefined, true],
  ])("classifies demand and support-noise fixtures: %s", (title, body, authorType, expected) => {
    expect(evaluateDiscourseDepth({ title, body, authorType, postsCount: 3 }).eligible).toBe(expected);
  });

  it("drops vendor self-promotion and duplicate post IDs from reply evidence", () => {
    const duplicate = { id: 45, postNumber: 2, body: "Our team switched from the old tool; this alternative is simpler.", username: "bob", createdAt: "2025-01-03T10:00:00.000Z", likeCount: 8 };
    const vendor = { id: 49, postNumber: 6, body: "We work for Acme and our product solves this.", username: "vendor", createdAt: "2025-01-07T10:00:00.000Z", likeCount: 99 };
    expect(selectDiscoursePosts({ posts: [
      { id: 44, postNumber: 1, body: "We need a workflow tool.", username: "alice", userId: 9, createdAt: "2025-01-02T10:00:00.000Z" },
      duplicate,
      { ...duplicate, body: "duplicate payload" },
      vendor,
    ], maxPosts: 8 }).map((post) => post.id)).toEqual([44, 45]);
  });

  it("propagates planner v8 and bounded Discourse metadata", () => {
    const request = toSourceDiscoveryRequest({
      sourcePlan: { source_key: "discourse" } as never,
      query: { query_id: "q1", query_family: "pain", demand_surface: "pain_first", competitor_specific: false, intent_type: "problem_solution_search", query_text: "planning workflow", normalized_query: "planning workflow", source_key: "discourse", priority: "high", confidence: 0.8, candidate_budget: 6, reason_codes: [], reason_summary: "test", concept_keys: [], competitor_refs: [], alternative_refs: [], geo_context: null, language_context: null, cost_hint: "free_rate_limited", metadata: { planner_version: "query_planning_v8" } },
      maxPages: 2,
    });
    expect(request.requestMetadata).toMatchObject({ queryPlanVersion: "query_planning_v8", discourseV1: true, depthPolicyVersion: "discourse_depth_v1", maxDepthTopicsPerPage: 3, maxPostsPerTopic: 8, maxDepthRequests: 12 });
  });
});
