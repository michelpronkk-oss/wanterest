const alice = {
  did: "did:plc:alice123",
  handle: "alice.example",
  displayName: "Alice Example",
};

const bob = {
  did: "did:plc:bob456",
  handle: "bob.example",
  displayName: "Bob Example",
};

export const blueskyStandalonePost = {
  uri: "at://did:plc:alice123/app.bsky.feed.post/standalone1",
  cid: "bafyreistandalone1",
  author: alice,
  record: {
    $type: "app.bsky.feed.post",
    text: "Looking for a calmer CRM workflow.",
    createdAt: "2026-09-19T10:00:00.000Z",
    langs: ["en"],
  },
  likeCount: 4,
  repostCount: 1,
  replyCount: 2,
  quoteCount: 0,
};

export const blueskyReplyPost = {
  uri: "at://did:plc:bob456/app.bsky.feed.post/reply1",
  cid: "bafyreireply1",
  author: bob,
  record: {
    $type: "app.bsky.feed.post",
    text: "Same here, especially for small teams.",
    createdAt: "2026-09-19T10:03:00.000Z",
    langs: ["en"],
    reply: {
      root: { uri: blueskyStandalonePost.uri, cid: blueskyStandalonePost.cid },
      parent: { uri: blueskyStandalonePost.uri, cid: blueskyStandalonePost.cid },
    },
  },
};

export const blueskyQuotePost = {
  uri: "at://did:plc:bob456/app.bsky.feed.post/quote1",
  cid: "bafyreiquote1",
  author: bob,
  record: {
    $type: "app.bsky.feed.post",
    text: "This is the gap I keep seeing.",
    createdAt: "2026-09-19T10:05:00.000Z",
    langs: ["en"],
    embed: {
      $type: "app.bsky.embed.record",
      record: { uri: blueskyStandalonePost.uri, cid: blueskyStandalonePost.cid },
    },
  },
};

export const blueskyQuoteWithMediaPost = {
  ...blueskyQuotePost,
  uri: "at://did:plc:bob456/app.bsky.feed.post/quote2",
  cid: "bafyreiquote2",
  record: {
    ...blueskyQuotePost.record,
    embed: {
      $type: "app.bsky.embed.recordWithMedia",
      record: {
        $type: "app.bsky.embed.record",
        record: { uri: blueskyStandalonePost.uri, cid: blueskyStandalonePost.cid },
      },
    },
  },
};

export const blueskyMissingDisplayNamePost = {
  ...blueskyStandalonePost,
  uri: "at://did:plc:alice123/app.bsky.feed.post/missing-display",
  cid: "bafyreimissingdisplay",
  author: { did: alice.did, handle: alice.handle },
};

export const blueskyMultiLanguagePost = {
  ...blueskyStandalonePost,
  uri: "at://did:plc:alice123/app.bsky.feed.post/multilang",
  cid: "bafyreimultilang",
  record: { ...blueskyStandalonePost.record, langs: ["en", "de"] },
};

export const blueskyChangedPost = {
  ...blueskyStandalonePost,
  cid: "bafyreistandalone1changed",
  record: { ...blueskyStandalonePost.record, text: "Updated CRM workflow request." },
};

export const blueskyMalformedPost = {
  uri: "at://did:plc:alice123/app.bsky.feed.post/malformed",
  cid: "bafyreimalformed",
  author: alice,
  record: { text: 42, createdAt: "not-a-timestamp" },
};

export const blueskyPageOne = {
  posts: [blueskyStandalonePost, blueskyReplyPost, blueskyQuotePost, blueskyMalformedPost],
  cursor: "bluesky-cursor-page-two",
};

export const blueskyPageTwo = {
  posts: [blueskyMissingDisplayNamePost, blueskyMultiLanguagePost],
};
