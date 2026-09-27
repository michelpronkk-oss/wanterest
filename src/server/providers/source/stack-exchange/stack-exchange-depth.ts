import { createSharedDepthTelemetry, type SharedDepthTelemetry } from "../depth";

export const STACK_EXCHANGE_DEPTH_VERSION = "stack_exchange_depth_v1" as const;
export const STACK_EXCHANGE_DEPTH_MAX_ROOTS_PER_PAGE = 3;
export const STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION = 3;
export const STACK_EXCHANGE_DEPTH_MAX_QUESTION_COMMENTS = 3;
export const STACK_EXCHANGE_DEPTH_MAX_ANSWER_COMMENTS = 2;
export const STACK_EXCHANGE_DEPTH_MAX_COMMENT_PAGES = 2;
export const STACK_EXCHANGE_DEPTH_MAX_REQUESTS = 12;

export type StackExchangeDepthTelemetry = SharedDepthTelemetry & {
  answersLoaded: number;
  answersPersisted: number;
};

export function createStackExchangeDepthTelemetry(): StackExchangeDepthTelemetry {
  return {
    ...createSharedDepthTelemetry(STACK_EXCHANGE_DEPTH_VERSION),
    answersLoaded: 0,
    answersPersisted: 0,
  };
}

const DEMAND_TERMS = [
  "need",
  "looking for",
  "recommend",
  "recommendation",
  "alternative to",
  "replace",
  "replacement",
  "switch",
  "migrat",
  "workaround",
  "feature request",
  "would like",
  "project management",
  "workflow",
  "tool",
  "software",
] as const;

const AUTOMATION_TERMS = ["bot", "automated", "dependency", "release", "security", "spam", "off-topic"] as const;

export type StackExchangeDepthQuestion = {
  title: string;
  body?: string;
  answerCount: number;
  commentCount: number;
  ownerType?: string;
  tags?: readonly string[];
  closedReason?: string;
  deleted?: boolean;
};

export type StackExchangeDepthEligibility = {
  eligible: boolean;
  reason: "eligible" | "not_demand_like" | "no_messages" | "automation" | "closed_or_deleted";
  matchedTerm: string | null;
};

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function hasDemandLanguage(value: string): string | null {
  const normalizedValue = normalized(value);
  return DEMAND_TERMS.find((term) => normalizedValue.includes(term)) ?? null;
}

export function evaluateStackExchangeDepth(question: StackExchangeDepthQuestion): StackExchangeDepthEligibility {
  const title = normalized(question.title);
  const body = normalized(question.body);
  const tags = (question.tags ?? []).map(normalized);
  const text = `${title}\n${body}\n${tags.join(" ")}`;
  const ownerType = normalized(question.ownerType);
  const closedReason = normalized(question.closedReason);
  const automation = ownerType === "bot" || ownerType === "system" || AUTOMATION_TERMS.some((term) => tags.some((tag) => tag.includes(term)));
  if (automation) return { eligible: false, reason: "automation", matchedTerm: null };
  if (question.deleted || closedReason || /\b(linear regression|alternative method|alternative approach)\b/.test(text)) {
    return { eligible: false, reason: question.deleted || closedReason ? "closed_or_deleted" : "not_demand_like", matchedTerm: null };
  }
  if (question.answerCount <= 0 && question.commentCount <= 0) return { eligible: false, reason: "no_messages", matchedTerm: null };
  const jiraTechnical = /\bjira\b/.test(text) && /\b(plugin|install|installation|stack trace|exception|bug|configuration)\b/.test(text);
  if (jiraTechnical) return { eligible: false, reason: "not_demand_like", matchedTerm: null };
  const matchedTerm = hasDemandLanguage(text);
  return matchedTerm ? { eligible: true, reason: "eligible", matchedTerm } : { eligible: false, reason: "not_demand_like", matchedTerm: null };
}

export type StackExchangeAnswer = {
  answer_id: number;
  question_id: number;
  body?: string;
  link?: string;
  creation_date: number;
  last_activity_date?: number;
  score?: number;
  is_accepted?: boolean;
  owner?: { user_id?: number; display_name?: string; link?: string; user_type?: string };
};

export type StackExchangeComment = {
  comment_id: number;
  post_id: number;
  post_type?: "question" | "answer" | "article";
  body?: string;
  link?: string;
  creation_date: number;
  score?: number;
  owner?: { user_id?: number; display_name?: string; link?: string; user_type?: string };
};

function answerScore(answer: StackExchangeAnswer): number {
  return answer.score ?? 0;
}

export function selectStackExchangeAnswers(input: {
  answers: readonly StackExchangeAnswer[];
  acceptedAnswerId?: number;
  maxAnswers?: number;
}): StackExchangeAnswer[] {
  const maxAnswers = Math.max(1, Math.min(STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION, Math.floor(input.maxAnswers ?? STACK_EXCHANGE_DEPTH_MAX_ANSWERS_PER_QUESTION)));
  const unique = [...new Map(input.answers.map((answer) => [answer.answer_id, answer])).values()];
  const accepted = unique.find((answer) => answer.answer_id === input.acceptedAnswerId || answer.is_accepted === true);
  const ordered = unique.filter((answer) => answer !== accepted).sort((left, right) => answerScore(right) - answerScore(left) || left.creation_date - right.creation_date || left.answer_id - right.answer_id);
  return [ ...(accepted ? [accepted] : []), ...ordered ].slice(0, maxAnswers);
}

export function selectStackExchangeComments(input: {
  comments: readonly StackExchangeComment[];
  maxComments: number;
}): StackExchangeComment[] {
  const maxComments = Math.max(0, Math.floor(input.maxComments));
  const unique = [...new Map(input.comments.map((comment) => [comment.comment_id, comment])).values()];
  return unique
    .filter((comment) => (comment.score ?? 0) > 0 || Boolean(hasDemandLanguage(comment.body ?? "")))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.creation_date - right.creation_date || left.comment_id - right.comment_id)
    .slice(0, maxComments);
}
