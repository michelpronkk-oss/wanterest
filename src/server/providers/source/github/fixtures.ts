export const githubIssue = {
  id: 101,
  node_id: "I_kwDOissue101",
  number: 42,
  title: "Export workflow loses filters",
  body: "The export workflow should preserve the selected filters.",
  html_url: "https://github.com/acme/product/issues/42",
  url: "https://api.github.com/repos/acme/product/issues/42",
  user: { id: 7, node_id: "MDQ6VXNlcjc=", login: "alice", type: "User", html_url: "https://github.com/alice" },
  repository: { id: 9001, node_id: "MDEwOlJlcG9zaXRvcnk5MDAx", name: "product", full_name: "acme/product", html_url: "https://github.com/acme/product", url: "https://api.github.com/repos/acme/product", owner: { id: 8, login: "acme", type: "Organization", html_url: "https://github.com/acme" }, private: false },
  repository_url: "https://api.github.com/repos/acme/product",
  state: "closed",
  locked: false,
  comments: 2,
  created_at: "2026-09-18T10:00:00.000Z",
  updated_at: "2026-09-19T10:00:00.000Z",
  closed_at: "2026-09-19T11:00:00.000Z",
  labels: [{ name: "bug", color: "d73a4a", description: "Something is not working" }],
  milestone: { number: 3, title: "September", state: "open" },
  reactions: { total_count: 3, "+1": 2, laugh: 1 },
};

export const githubPullRequest = {
  ...githubIssue,
  id: 102,
  number: 43,
  title: "A pull request that must be filtered",
  pull_request: { html_url: "https://github.com/acme/product/pull/43" },
};

export const githubIssueComment = {
  id: 7001,
  node_id: "IC_kwDOcomment7001",
  body: "This is reproducible on the current export path.",
  html_url: "https://github.com/acme/product/issues/42#issuecomment-7001",
  url: "https://api.github.com/repos/acme/product/issues/comments/7001",
  user: { id: 9, node_id: "MDQ6VXNlcjk=", login: "bot-helper", type: "Bot", html_url: "https://github.com/apps/bot-helper" },
  created_at: "2026-09-19T12:00:00.000Z",
  updated_at: "2026-09-19T12:30:00.000Z",
  author_association: "CONTRIBUTOR",
  reactions: { total_count: 1, "+1": 1 },
};

export const githubDiscussionComment = {
  id: "DC_kwDOfirstcomment",
  body: "A useful follow-up.",
  url: "https://github.com/acme/product/discussions/5#discussioncomment-1",
  createdAt: "2026-09-19T13:00:00.000Z",
  updatedAt: "2026-09-19T13:05:00.000Z",
  author: { id: "MDQ6VXNlcjEw", login: "bob", url: "https://github.com/bob", __typename: "User" },
};

export const githubDiscussion = {
  id: "D_kwDOdiscussion5",
  number: 5,
  title: "How should exports handle filters?",
  body: "What export behavior do people expect?",
  url: "https://github.com/acme/product/discussions/5",
  createdAt: "2026-09-17T09:00:00.000Z",
  updatedAt: "2026-09-19T13:00:00.000Z",
  author: { id: "MDQ6VXNlcjEx", login: "carol", url: "https://github.com/carol", __typename: "User" },
  category: { name: "Ideas" },
  repository: { id: "R_kgDOrepo9001", name: "product", nameWithOwner: "acme/product", url: "https://github.com/acme/product", owner: { login: "acme" } },
  comments: { nodes: [githubDiscussionComment], pageInfo: { hasNextPage: false, endCursor: null } },
};

export const githubIssueSearchResponse = {
  total_count: 2,
  incomplete_results: false,
  items: [githubIssue, githubPullRequest],
};

export const githubDiscussionsResponse = {
  data: { search: { nodes: [githubDiscussion], pageInfo: { hasNextPage: true, endCursor: "discussion-cursor-2" } } },
};
