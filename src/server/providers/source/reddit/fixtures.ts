export const redditStandalonePost = {
  kind: "t3",
  data: {
    id: "post1",
    name: "t3_post1",
    title: "Looking for a calmer CRM workflow",
    selftext: "I need a less noisy way to follow up with leads.",
    author: "alice",
    author_fullname: "t2_alice",
    subreddit: "startups",
    subreddit_id: "t5_startups",
    subreddit_type: "public",
    permalink: "/r/startups/comments/post1/looking_for_a_calmer_crm_workflow/",
    url: "https://example.com/workflow",
    created_utc: 1789812000,
    is_self: true,
    score: 12,
    num_comments: 2,
    upvote_ratio: 0.96,
  },
};

export const redditLinkPost = {
  kind: "t3",
  data: {
    id: "link1",
    name: "t3_link1",
    title: "A useful operations tool",
    selftext: "",
    author: "bob",
    author_fullname: "t2_bob",
    subreddit: "Entrepreneur",
    subreddit_id: "t5_entrepreneur",
    permalink: "/r/Entrepreneur/comments/link1/a_useful_operations_tool/",
    url: "https://example.com/tool",
    created_utc: 1789812060,
    is_self: false,
    domain: "example.com",
    score: 7,
  },
};

export const redditNoSelftextPost = {
  ...redditLinkPost,
  data: { ...redditLinkPost.data, id: "link2", name: "t3_link2", selftext: null },
};

export const redditRemovedPost = {
  ...redditStandalonePost,
  data: { ...redditStandalonePost.data, id: "removed1", name: "t3_removed1", title: "[removed]", selftext: "[removed]", removed_by_category: "moderator" },
};

export const redditChangedPost = {
  ...redditStandalonePost,
  data: { ...redditStandalonePost.data, selftext: "The workflow still creates too much follow-up work." },
};

export const redditCrosspost = {
  ...redditStandalonePost,
  data: {
    ...redditStandalonePost.data,
    id: "cross1",
    name: "t3_cross1",
    title: redditStandalonePost.data.title,
    crosspost_parent: "t3_post1",
  },
};

export const redditMalformedListingChild = { kind: "t3", data: { id: 42 } };
export const redditUnauthorizedResponse = { message: "Unauthorized", error: 401 };
export const redditForbiddenResponse = { message: "Forbidden", error: 403 };
export const redditRateLimitedResponse = { message: "Too Many Requests", error: 429 };
export const redditServerErrorResponse = { message: "Service Unavailable", error: 503 };

export const redditRootComment = {
  kind: "t1",
  data: {
    id: "comment1",
    name: "t1_comment1",
    body: "I have the same problem with follow-up noise.",
    author: "carol",
    author_fullname: "t2_carol",
    parent_id: "t3_post1",
    link_id: "t3_post1",
    subreddit: "startups",
    subreddit_id: "t5_startups",
    permalink: "/r/startups/comments/post1/looking_for_a_calmer_crm_workflow/comment1/",
    created_utc: 1789812120,
    score: 3,
    depth: 0,
    replies: { kind: "Listing", data: { children: [] } },
  },
};

export const redditNestedComment = {
  kind: "t1",
  data: {
    id: "comment2",
    name: "t1_comment2",
    body: "Exactly. A small workflow would help.",
    author: "dave",
    author_fullname: "t2_dave",
    parent_id: "t1_comment1",
    link_id: "t3_post1",
    subreddit: "startups",
    permalink: "/r/startups/comments/post1/looking_for_a_calmer_crm_workflow/comment2/",
    created_utc: 1789812180,
    score: 1,
    depth: 1,
    replies: { kind: "Listing", data: { children: [] } },
  },
};

export const redditDeletedComment = {
  kind: "t1",
  data: {
    id: "comment3",
    name: "t1_comment3",
    body: "[deleted]",
    author: null,
    parent_id: "t3_post1",
    link_id: "t3_post1",
    subreddit: "startups",
    permalink: "/r/startups/comments/post1/looking_for_a_calmer_crm_workflow/comment3/",
    created_utc: 1789812240,
    depth: 0,
  },
};

export const redditMorePlaceholder = { kind: "more", data: { count: 100, children: [] } };

export const redditSearchPageOne = {
  kind: "Listing",
  data: { after: "t3_link2", before: null, children: [redditStandalonePost, redditLinkPost, redditRemovedPost, { kind: "t3", data: { id: 42 } }] },
};

export const redditSearchPageTwo = {
  kind: "Listing",
  data: { after: null, before: null, children: [redditNoSelftextPost, redditStandalonePost] },
};

export const redditCommentsResponse = [
  { kind: "Listing", data: { children: [redditStandalonePost] } },
  { kind: "Listing", data: { children: [redditRootComment, { kind: "t1", data: redditNestedComment.data }, redditDeletedComment, redditMorePlaceholder] } },
];

export const redditTokenResponse = { access_token: "reddit-test-token", token_type: "bearer", expires_in: 3_600, scope: "*" };
