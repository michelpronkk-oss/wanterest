import { createSharedDepthTelemetry, type SharedDepthTelemetry } from "../depth";

export const DISCOURSE_DEPTH_VERSION = "discourse_depth_v1" as const;
export const DISCOURSE_DEPTH_MAX_TOPICS_PER_PAGE = 3;
export const DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC = 8;
export const DISCOURSE_DEPTH_MAX_TOPIC_PAGES = 2;
export const DISCOURSE_DEPTH_MAX_REQUESTS = 12;

export type DiscourseDepthTelemetry = SharedDepthTelemetry & {
  postsLoaded: number;
  postsPersisted: number;
  rateLimitSkips: number;
  capSkips: number;
};

export function createDiscourseDepthTelemetry(): DiscourseDepthTelemetry {
  return {
    ...createSharedDepthTelemetry(DISCOURSE_DEPTH_VERSION),
    postsLoaded: 0,
    postsPersisted: 0,
    rateLimitSkips: 0,
    capSkips: 0,
  };
}

const DEMAND_TERMS = [
  "need",
  "looking for",
  "recommend",
  "recommendation",
  "alternative",
  "replace",
  "replacement",
  "switch",
  "migrat",
  "workflow",
  "feature request",
  "would like",
  "struggling",
  "pain",
  "friction",
  "pricing",
  "purchase",
  "buy",
  "adopt",
  "capability",
  "integration",
] as const;

const NOISE_TERMS = [
  "moderator",
  "moderation",
  "release notes",
  "changelog",
  "announcement",
  "welcome to",
  "stack trace",
  "traceback",
  "exception",
  "error log",
  "spam",
] as const;

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function hasDemandLanguage(value: string): string | null {
  const text = normalized(value);
  return DEMAND_TERMS.find((term) => text.includes(term)) ?? null;
}

function isNoiseText(value: string): boolean {
  const text = normalized(value);
  return NOISE_TERMS.some((term) => text.includes(term));
}

export function isDiscourseAutomatedAuthor(authorType: string | null | undefined, username: string | null | undefined): boolean {
  const type = normalized(authorType);
  const name = normalized(username);
  return type === "bot" || type === "system" || type === "automation" || name.endsWith("[bot]") || name.includes("_bot");
}

export type DiscourseDepthTopic = {
  title: string;
  body?: string | null;
  tags?: readonly string[];
  category?: string | null;
  state?: string | null;
  authorType?: string | null;
  authorUsername?: string | null;
  postsCount: number;
  deleted?: boolean;
};

export type DiscourseDepthEligibilityReason = "eligible" | "not_demand_like" | "no_replies" | "moderation" | "closed_archived" | "automation";

export type DiscourseDepthEligibility = {
  eligible: boolean;
  reason: DiscourseDepthEligibilityReason;
  matchedTerm: string | null;
};

export function evaluateDiscourseDepth(topic: DiscourseDepthTopic): DiscourseDepthEligibility {
  const state = normalized(topic.state);
  if (topic.deleted || state === "closed" || state === "archived" || state === "deleted") return { eligible: false, reason: "closed_archived", matchedTerm: null };
  if (isDiscourseAutomatedAuthor(topic.authorType, topic.authorUsername)) return { eligible: false, reason: "automation", matchedTerm: null };
  const text = `${topic.title}\n${topic.body ?? ""}\n${topic.category ?? ""}\n${(topic.tags ?? []).join(" ")}`;
  if (isNoiseText(text) && !hasDemandLanguage(text)) return { eligible: false, reason: "moderation", matchedTerm: null };
  if (topic.postsCount <= 1) return { eligible: false, reason: "no_replies", matchedTerm: null };
  const matchedTerm = hasDemandLanguage(text);
  return matchedTerm ? { eligible: true, reason: "eligible", matchedTerm } : { eligible: false, reason: "not_demand_like", matchedTerm: null };
}

export type DiscourseDepthPost = {
  id: number;
  postNumber: number;
  body?: string | null;
  username?: string | null;
  authorType?: string | null;
  userId?: number | null;
  replyToPostNumber?: number | null;
  createdAt: string;
  updatedAt?: string | null;
  likeCount?: number | null;
  hidden?: boolean;
  deleted?: boolean;
  isSolution?: boolean;
};

function postDemandScore(post: DiscourseDepthPost): number {
  const body = post.body ?? "";
  if (post.isSolution) return 4;
  if (hasDemandLanguage(body)) return 3;
  if (post.replyToPostNumber === null || post.replyToPostNumber === undefined) return 1;
  return 0;
}

function originalPosterFollowup(post: DiscourseDepthPost, root: DiscourseDepthPost): boolean {
  return (post.userId !== null && post.userId !== undefined && root.userId !== null && root.userId !== undefined && post.userId === root.userId)
    || (Boolean(post.username) && Boolean(root.username) && normalized(post.username) === normalized(root.username));
}

function isVendorSelfPromotion(post: DiscourseDepthPost): boolean {
  const body = normalized(post.body);
  return /\b(i|we)\s+(work|worked)\s+(for|at)\b/.test(body) && /\b(our|my)\s+(product|platform|service|company)\b/.test(body);
}

export function selectDiscoursePosts(input: {
  posts: readonly DiscourseDepthPost[];
  acceptedPostId?: number | null;
  maxPosts?: number;
}): DiscourseDepthPost[] {
  const maxPosts = Math.max(1, Math.min(DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC, Math.floor(input.maxPosts ?? DISCOURSE_DEPTH_MAX_POSTS_PER_TOPIC)));
  const unique = [...new Map(input.posts.map((post) => [post.id, post])).values()];
  const root = unique.find((post) => post.postNumber === 1) ?? unique[0];
  if (!root) return [];
  const acceptedPostId = input.acceptedPostId ?? null;
  const selected = unique
    .filter((post) => post.id !== root.id)
    .filter((post) => !post.deleted && !post.hidden && !isDiscourseAutomatedAuthor(post.authorType, post.username))
    .filter((post) => !isVendorSelfPromotion(post))
    .filter((post) => post.id === acceptedPostId || post.isSolution || postDemandScore(post) > 0)
    .sort((left, right) => {
      const priority = (post: DiscourseDepthPost) => post.isSolution || post.id === acceptedPostId ? 4 : originalPosterFollowup(post, root) ? 3.5 : postDemandScore(post);
      const score = priority(right) - priority(left);
      if (score) return score;
      const likes = (right.likeCount ?? 0) - (left.likeCount ?? 0);
      if (likes) return likes;
      const created = left.createdAt.localeCompare(right.createdAt);
      return created || left.id - right.id;
    });
  return [root, ...selected.slice(0, maxPosts - 1)];
}

export function cleanDiscourseContent(cooked: string | null | undefined, raw: string | null | undefined): string {
  const source = cooked?.trim() || raw?.trim() || "";
  return source
    .replace(/<br\s*\/?>(?=\s*)/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|pre|h[1-6])>/gi, "\n")
    .replace(/<pre[^>]*>/gi, "\n")
    .replace(/<code[^>]*>/gi, "")
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
