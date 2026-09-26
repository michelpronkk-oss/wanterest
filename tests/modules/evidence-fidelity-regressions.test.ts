import { describe, expect, it } from "vitest";

import type { ConversationAnalysisRow, ConversationRow, SourceItemRow } from "../../src/server/db/database.helpers";
import { deterministicUuid, sha256Text } from "../../src/server/modules/ingestion/hash";
import { qualifySignal, type SignalQualificationInput } from "../../src/server/modules/intelligence";
import type { SignalQualification } from "../../src/server/modules/intelligence/signal-qualification.schemas";

/**
 * Layer 12A.3A.1 golden fixture: 19 audited/representative production failure
 * classes (17 originally audited-pattern classes + 2 new Hacker News-sourced
 * cases from Search v2), reproduced against the CURRENT (post-fix) code. Each
 * case documents, in its own description, what the pre-12A.3A.1 deterministic
 * classifier would have produced and why (traced against the actual, unchanged
 * regex/branch logic these fixtures exercise) so the before/after contrast is
 * verifiable from the fixture itself rather than asserted from memory.
 */

const productId = deterministicUuid("evidence-fidelity-product");

function inputFor(body: string, options: { productName?: string; repository?: string; authorAssociation?: string; sourceKey?: string; publishedAt?: string; now?: string; title?: string } = {}): SignalQualificationInput {
  const productName = options.productName ?? "Linear";
  const sourceKey = options.sourceKey ?? "github";
  const publishedAt = options.publishedAt ?? "2026-09-23T00:00:00.000Z";
  const now = options.now ?? "2026-09-23T00:00:00.000Z";
  const conversationId = deterministicUuid(`evidence-fidelity-conversation:${body}:${productName}:${sourceKey}`);
  const sourceId = deterministicUuid(`evidence-fidelity-source:${body}:${productName}:${sourceKey}`);
  const metadata = {
    ...(options.repository ? { repository: options.repository, repositoryName: options.repository.split("/").at(-1) } : {}),
    ...(options.authorAssociation ? { authorAssociation: options.authorAssociation } : {}),
  };
  const source: SourceItemRow = {
    id: sourceId,
    evidence_node_id: deterministicUuid(`evidence-fidelity-source-evidence:${sourceId}`),
    source_key: sourceKey,
    external_id: `evidence-fidelity:${sourceId}`,
    external_conversation_id: conversationId,
    canonical_url: `https://example.com/${sourceKey}/1`,
    author_external_id: `${sourceKey}:user:1`,
    author_display_name: "author",
    author_profile_url: null,
    title: options.title ?? null,
    body,
    published_at: publishedAt,
    captured_at: publishedAt,
    language: "en",
    metadata,
    content_hash: sha256Text(body),
    latest_raw_source_item_id: deterministicUuid(`evidence-fidelity-raw:${sourceId}`),
    normalization_version: "fixture-v1",
    status: "active",
    created_at: publishedAt,
    updated_at: publishedAt,
  } as unknown as SourceItemRow;
  const conversation: ConversationRow = {
    id: conversationId,
    evidence_node_id: deterministicUuid(`evidence-fidelity-conversation-evidence:${conversationId}`),
    conversation_key: `fixture:evidence-fidelity:${conversationId}`,
    primary_source_item_id: sourceId,
    canonical_url: source.canonical_url,
    author_external_id: source.author_external_id,
    author_display_name: source.author_display_name,
    author_profile_url: source.author_profile_url,
    title: source.title,
    body,
    published_at: source.published_at,
    last_activity_at: source.published_at,
    captured_at: source.captured_at,
    language: source.language,
    metadata,
    content_hash: source.content_hash,
    canonicalization_version: "fixture-v1",
    created_at: source.created_at,
    updated_at: source.updated_at,
  } as unknown as ConversationRow;
  const analysis: ConversationAnalysisRow = {
    id: deterministicUuid(`evidence-fidelity-analysis:${conversationId}`),
    conversation_id: conversationId,
    evidence_node_id: deterministicUuid(`evidence-fidelity-analysis-evidence:${conversationId}`),
    engine_version_id: deterministicUuid("evidence-fidelity-analysis-engine"),
    input_fingerprint: sha256Text(`evidence-fidelity-analysis:${conversationId}`),
    intent_type: "switching_intent",
    pain_themes: ["workflow pain"],
    desired_outcomes: [],
    alternatives: ["Jira"],
    buyer_language: ["we need"],
    audience_signals: ["engineering team"],
    specificity: 0.85,
    urgency: null,
    confidence: 0.9,
    status: "completed",
    skip_reason: null,
    evidence_spans: [],
    provider: "fixture",
    model: "deterministic",
    prompt_version: "fixture-v1",
    usage_metadata: {},
    created_at: source.created_at,
  } as unknown as ConversationAnalysisRow;
  return {
    candidateId: conversationId,
    productId,
    productName,
    conversation,
    sourceItem: source,
    analysis,
    match: {
      decision: "qualified",
      matchConfidence: 0.92,
      rationale: "Fixture match.",
      evidence: { painAlignment: ["workflow"], buyerAlignment: ["engineering team"], capabilityAlignment: [], intentRelevance: ["switching_intent"] },
    },
    profile: {
      relevant_pains: ["workflow"],
      relevant_outcomes: ["faster issue tracking"],
      relevant_intents: [{ intent_type: "switching_intent", relevance: 0.9 }],
      relevant_jtbd: ["manage engineering work"],
      relevant_features: ["importer"],
      buyer_roles: ["engineering team"],
      competitors: [{ name: "Jira", confidence: 0.95 }],
      alternatives: [{ label: "spreadsheet", alternative_type: "manual_process", confidence: 0.8 }],
      geography: { market_scope: "global", primary_country_code: null, primary_region: null, primary_city: null, location_dependency: 0, demand_geography_terms: [] },
      profile_confidence: 0.95,
      primary_category: "issue tracking software",
      profile_version: "demand_profile_v2",
    },
    now: new Date(now),
  };
}

type Case = { id: string; description: string; body: string; options?: Parameters<typeof inputFor>[1]; assert: (result: SignalQualification) => void };

const cases: Case[] = [
  {
    id: "1-x509-protocol-technical-discussion",
    description: "X.509 client certificate discussion: pre-fix, X.509 was not covered by AUTHENTICATION_TERMS, so this could fall through into a product-relationship branch. Now: detectIntentTarget recognizes it as authentication and directional-demand.ts (unified with intent-semantics.ts) routes it to implementation, not switching/category demand.",
    body: "We need an alternative X.509 client certificate authentication method for our internal tooling.",
    assert: (result) => {
      expect(result.intent_target).toBe("authentication");
      expect(result.demand_target_type).toBe("implementation");
      expect(result.status).not.toBe("qualified");
      expect(result.status).not.toBe("high_confidence_signal");
    },
  },
  {
    id: "2-sso-alternative-method-technical",
    description: "\"alternative method\" phrasing about SSO/TLS: previously only oauth/auth/login-style words were recognized; sso/tls now included in the shared AUTHENTICATION_TERMS so this is not misread as an alternative-product search.",
    body: "Is there an alternative SSO method we can configure besides the current TLS-based login flow?",
    assert: (result) => {
      expect(result.intent_target).toBe("authentication");
      expect(result.demand_target_type).toBe("implementation");
    },
  },
  {
    id: "3-linear-regression-not-product",
    description: "\"linear regression\" collocation: pre-fix, a bare word-boundary match on the product name \"Linear\" inside a math/technical phrase would register as a mentioned/source product. Now entity-disambiguation.ts's collocation guard rejects it and no Linear-relationship claim is made.",
    body: "We ran a linear regression on the churn dataset and the R-squared was low.",
    assert: (result) => {
      expect(result.demand_target_type).not.toBe("scanned_product");
      expect(result.source_products).not.toContain("Linear");
      expect(result.status).not.toBe("qualified");
    },
  },
  {
    id: "4-linear-algebra-not-product",
    description: "\"linear algebra\"/\"linear time\" collocation: same false-positive class as case 3, different technical phrase, proving the guard generalizes across the collocation list rather than a single hardcoded phrase.",
    body: "The new indexing approach scales in linear time instead of quadratic, using basic linear algebra.",
    assert: (result) => {
      expect(result.source_products).not.toContain("Linear");
      expect(result.status).not.toBe("qualified");
    },
  },
  {
    id: "5-technical-config-only-mention",
    description: "Technical-config-only mention: describing a deployment/config detail, not requesting a product change or switch. IMPLEMENTATION_TERMS now includes config(uration)/deployment/self-hosting/maintenance so this routes to implementation, not a category/product claim.",
    body: "Our self-hosted deployment configuration needs a maintenance window before the next upgrade.",
    assert: (result) => {
      expect(result.intent_target === "implementation" || result.demand_target_type === "unknown").toBe(true);
      expect(result.status).not.toBe("qualified");
    },
  },
  {
    id: "6-integration-maintenance-only-mention",
    description: "Integration/maintenance-only mention in a host repository: a maintainer discussing upkeep of an existing integration, not switching demand. Covered by the existing maintainer-roadmap guard (speaker_role) plus the unified implementation detector.",
    body: "Routine maintenance: updating our Jira integration's webhook endpoint configuration.",
    options: { repository: "acme/product-a", authorAssociation: "OWNER" },
    assert: (result) => {
      expect(result.speaker_role).toBe("maintainer");
      expect(result.status).not.toBe("qualified");
      expect(result.status).not.toBe("high_confidence_signal");
    },
  },
  {
    id: "7-vendor-pitch-non-hn",
    description: "Vendor pitch (non-HN source) naming a competitor with no explicit marketing CTA (so the pre-existing promotional-content regex alone would not catch it): pre-fix, first-person \"we\" + \"alternative to Jira\" satisfied the buyer-language pattern and speaker_role could read as buyer. Now authorial-stance.ts classifies this as vendor_marketing, speaker_role is not buyer, and reasonText states it is vendor positioning, not buyer demand.",
    body: "We just launched Orbit, a simpler alternative to Jira for small teams.",
    options: { productName: "Orbit", sourceKey: "bluesky", repository: undefined },
    assert: (result) => {
      expect(result.speaker_role).not.toBe("buyer");
      expect(result.reason_codes).toContain("VENDOR_PITCH_NOT_BUYER_DEMAND");
      expect(result.qualification_reason).toMatch(/vendor positioning/i);
      expect(result.qualification_reason).not.toMatch(/^User is/i);
    },
  },
  {
    id: "8-show-hn-vendor-pitch",
    description: "Hacker News-sourced vendor pitch (Search v2 case 1/2): a Show HN-style launch naming a competitor. The HN pain-first launch filter (hackerNewsPainLaunchMismatchReason) already suppresses literal 'Show HN:' titles at candidate-selection time; this case exercises the same misattribution guard for a launch post whose body (not title) is promotional, from Hacker News evidence surfaced through 12A.3A search v2.",
    body: "Show HN: We built Orbit, an open-source alternative to Jira for indie teams.",
    options: { productName: "Orbit", sourceKey: "hacker-news" },
    assert: (result) => {
      expect(result.speaker_role).not.toBe("buyer");
      expect(result.reason_codes).toContain("VENDOR_PITCH_NOT_BUYER_DEMAND");
    },
  },
  {
    id: "9-third-party-tutorial-guide-mention",
    description: "Third-party tutorial/guide mention: SEO/editorial comparison content, not a first-person conversation. Already guarded by the existing promotional-editorial detector (signal-quality.ts); included here to confirm 12A.3A.1's changes do not weaken that existing guard.",
    body: "Linear vs Jira: Why Developer Teams Are Switching in 2026. Learn how teams compare the two tools in this complete guide.",
    options: { sourceKey: "bluesky" },
    assert: (result) => {
      expect(result.status).not.toBe("qualified");
      expect(result.status).not.toBe("high_confidence_signal");
    },
  },
  {
    id: "10-genuine-switching-intent-positive-control",
    description: "Positive control: genuine, unambiguous first-person switching intent naming a real competitor must still qualify after 12A.3A.1 - the hardening must not create false negatives.",
    body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.",
    assert: (result) => {
      expect(result.demand_direction).toBe("toward_product");
      expect(["qualified", "high_confidence_signal"]).toContain(result.status);
    },
  },
  {
    id: "11-genuine-buyer-evaluating-scanned-product",
    description: "Positive control: a genuine buyer evaluating the scanned product as a named alternative must still be attributed as a buyer, not downgraded by the vendor-pitch guard (no launch/pitch pattern is present here).",
    body: "We are evaluating Linear as a Jira alternative for our engineering team.",
    assert: (result) => {
      expect(result.speaker_role).not.toBe("unknown");
      expect(["qualified", "high_confidence_signal"]).toContain(result.status);
    },
  },
  {
    id: "12-maintainer-roadmap-context",
    description: "Existing maintainer-roadmap guard (pre-12A.3A.1, retained unchanged): a maintainer's own roadmap discussion is not buyer demand for the scanned product.",
    body: "We are planning migration support for Jira.",
    options: { repository: "linear/linear", authorAssociation: "MEMBER" },
    assert: (result) => {
      expect(result.speaker_role).toBe("maintainer");
      expect(result.dimensions.buyer_plausibility).toBeLessThanOrEqual(0.5);
    },
  },
  {
    id: "13-competitor-named-genuine-switch",
    description: "Positive control: a genuine competitor-named switch away from the scanned product must still be recognized as negative demand for the scanned product (not silently absorbed by the vendor-pitch or entity-disambiguation guards).",
    body: "We are leaving Linear and moving to Orbit because it fits our workflow better.",
    options: { repository: "Noveum/orbit" },
    assert: (result) => {
      expect(result.demand_direction).toBe("away_from_product");
      expect(result.status).not.toBe("qualified");
    },
  },
  {
    id: "14-hn-genuine-pain-qualifies",
    description: "Hacker News Search v2 case 2/2: a genuine, specific switching-pain comment sourced from Hacker News must still qualify after grounding - the hardening must not suppress real Hacker News evidence.",
    body: "Ask HN: what are you using instead of Jira? We are switching from Jira to Linear because our sales-engineering workflow needs faster issue tracking and Jira has become too slow for our 8-person team.",
    options: { sourceKey: "hacker-news", title: "Ask HN: what are you using instead of Jira?" },
    assert: (result) => {
      expect(["qualified", "high_confidence_signal"]).toContain(result.status);
      expect(result.demand_direction).toBe("toward_product");
    },
  },
  {
    id: "15-hn-linear-regression-technical-thread",
    description: "Hacker News technical discussion combining both classes: a comment discussing linear regression (not the product) in a thread with no genuine Linear-product mention must not manufacture demand for the scanned product Linear.",
    body: "Our churn model just uses linear regression with regularization; nothing fancy, and no need to switch our whole analytics stack.",
    options: { sourceKey: "hacker-news" },
    assert: (result) => {
      expect(result.source_products).not.toContain("Linear");
      expect(result.status).not.toBe("qualified");
    },
  },
  {
    id: "16-vague-short-reply-control",
    description: "Negative control: a vague, contentless reply must remain rejected - unaffected by any 12A.3A.1 change.",
    body: "same here",
    assert: (result) => {
      expect(result.status).not.toBe("qualified");
      expect(result.status).not.toBe("high_confidence_signal");
    },
  },
  {
    id: "17-old-published-content-temporal-qualifier",
    description: "Temporal presentation (minimum-safe fix): genuine switching intent published well over EVIDENCE_HISTORICAL_THRESHOLD_DAYS before the scan must state its actual published date and an explicit non-currency qualifier, never implying it is current demand.",
    body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.",
    options: { publishedAt: "2025-01-01T00:00:00.000Z", now: "2026-09-23T00:00:00.000Z" },
    assert: (result) => {
      expect(result.evidence_published_at).toBe("2025-01-01T00:00:00.000Z");
      expect(result.qualification_reason).toMatch(/2025-01-01/);
      expect(result.qualification_reason).toMatch(/may not reflect current demand/i);
    },
  },
  {
    id: "18-recent-published-content-no-stale-qualifier",
    description: "Temporal presentation, contrast case: recently published evidence states its date but never claims staleness it does not have.",
    body: "We are leaving Jira and moving to Linear because our engineering team needs faster issue tracking.",
    options: { publishedAt: "2026-09-20T00:00:00.000Z", now: "2026-09-23T00:00:00.000Z" },
    assert: (result) => {
      expect(result.evidence_published_at).toBe("2026-09-20T00:00:00.000Z");
      expect(result.qualification_reason).toMatch(/2026-09-20/);
      expect(result.qualification_reason).not.toMatch(/may not reflect current demand/i);
    },
  },
  {
    id: "19-query-competitor-context-cannot-fabricate-evidence",
    description: "Cross-cutting proof: the product profile's own structured competitor list (Jira) must never itself become evidence when the source text does not actually mention it - evidence_spans stay empty and the signal cannot qualify from profile/query context alone.",
    body: "Linear",
    assert: (result) => {
      expect(result.evidence_spans).toHaveLength(0);
      expect(result.status).not.toBe("qualified");
      expect(result.status).not.toBe("high_confidence_signal");
    },
  },
];

describe("Evidence fidelity golden fixture (12A.3A.1, 19 cases)", () => {
  it.each(cases)("$id: $description", ({ body, options, assert: assertion }) => {
    const result = qualifySignal(inputFor(body, options));
    assertion(result);
  });

  it("is fully deterministic - replaying the entire fixture set twice yields identical results", () => {
    for (const testCase of cases) {
      const input = inputFor(testCase.body, testCase.options);
      expect(qualifySignal(input)).toEqual(qualifySignal(input));
    }
  });
});
