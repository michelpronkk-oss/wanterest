export const xStandalonePost = {
  id: "1900000000000000001",
  text: "Looking for a calmer CRM workflow with better follow-up visibility.",
  author_id: "900000000000000001",
  conversation_id: "1900000000000000001",
  created_at: "2026-09-20T08:00:00.000Z",
  lang: "en",
  public_metrics: { like_count: 4, reply_count: 2, repost_count: 1, quote_count: 0, bookmark_count: 0, impression_count: 40 },
  reply_settings: "everyone",
  edit_history_tweet_ids: ["1900000000000000001"],
  possibly_sensitive: false,
};

export const xReplyPost = {
  ...xStandalonePost,
  id: "1900000000000000002",
  text: "The reporting part is what I keep missing too.",
  conversation_id: "1900000000000000001",
  in_reply_to_user_id: "900000000000000001",
  referenced_tweets: [{ type: "replied_to", id: "1900000000000000001" }],
};

export const xQuotePost = {
  ...xStandalonePost,
  id: "1900000000000000003",
  text: "This is exactly the workflow problem I mean.",
  conversation_id: "1900000000000000003",
  referenced_tweets: [{ type: "quoted", id: "1900000000000000001" }],
  entities: { urls: [{ start: 0, end: 4, url: "https://t.co/example" }] },
};

export const xRetweetPost = {
  ...xStandalonePost,
  id: "1900000000000000004",
  text: "RT @alice: Looking for a calmer CRM workflow.",
  referenced_tweets: [{ type: "retweeted", id: "1900000000000000001" }],
};

export const xMultilingualPost = {
  ...xStandalonePost,
  id: "1900000000000000005",
  text: "Je cherche un CRM plus simple.",
  lang: "fr",
};

export const xEditedPost = {
  ...xStandalonePost,
  id: "1900000000000000006",
  text: "Edited: looking for a calmer CRM workflow.",
  edit_history_tweet_ids: ["1900000000000000006", "1900000000000000001"],
};

export const xUserAlice = {
  id: "900000000000000001",
  name: "Alice Example",
  username: "alice_example",
  protected: false,
};

export const xProtectedUser = {
  id: "900000000000000002",
  name: "Private Example",
  username: "private_example",
  protected: true,
};

export const xMalformedPost = { id: "not-a-post", text: 42 };
export const xDuplicatePost = { ...xStandalonePost };

export const xInvalidQueryError = { title: "Invalid Request", detail: "The query is invalid." };
export const xAuthError = { title: "Unauthorized", detail: "Bearer token is invalid." };
export const xForbiddenError = { title: "Forbidden", detail: "The application is not permitted to use this endpoint." };
export const xCreditError = { title: "Monthly Product Cap", detail: "The monthly product cap has been reached." };
export const xRateLimitError = { title: "Too Many Requests", detail: "Rate limit exceeded." };
export const xServerError = { title: "Service Unavailable", detail: "Try again later." };

export const xPageOne = {
  data: [xStandalonePost, xReplyPost, xQuotePost, xRetweetPost, xMalformedPost],
  includes: { users: [xUserAlice] },
  meta: { result_count: 5, next_token: "x-next-page-token", newest_id: xStandalonePost.id, oldest_id: xRetweetPost.id },
};

export const xPageTwo = {
  data: [xMultilingualPost, xEditedPost],
  includes: { users: [xUserAlice] },
  meta: { result_count: 2, next_token: "x-final-page-token", newest_id: xMultilingualPost.id, oldest_id: xEditedPost.id },
};

export const xPostLookupResponse = {
  data: xQuotePost,
  includes: { users: [xUserAlice] },
};
