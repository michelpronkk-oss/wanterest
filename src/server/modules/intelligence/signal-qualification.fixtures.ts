export type SignalQualificationFixture = {
  name: string;
  expected: "qualified_or_high_confidence" | "weak_or_rejected";
  body: string;
  title?: string;
  sourceKey?: string;
  metadata?: Record<string, unknown>;
  profileKind?: "crm" | "running_shoes" | "local_dentist";
  analysisIntent?: string;
  painThemes?: string[];
  buyerLanguage?: string[];
  audienceSignals?: string[];
  specificity?: number;
  confidence?: number;
  matchConfidence?: number;
  matchDecision?: "qualified" | "weak" | "rejected";
};

export const signalQualificationFixtures: readonly SignalQualificationFixture[] = [
  { name: "explicit alternative search", expected: "qualified_or_high_confidence", body: "Any cheaper alternative to HubSpot for a 5-person sales team?", analysisIntent: "alternative_search", buyerLanguage: ["Any cheaper alternative"], audienceSignals: ["sales team"], specificity: 0.82 },
  { name: "explicit switching intent", expected: "qualified_or_high_confidence", body: "We're switching from HubSpot because the workflow is too expensive and complex for our sales team.", analysisIntent: "switching_intent", painThemes: ["too expensive", "complex workflow"], buyerLanguage: ["We're switching from HubSpot"], audienceSignals: ["sales team"], specificity: 0.9 },
  { name: "recommendation with buyer context", expected: "qualified_or_high_confidence", body: "Looking for the best CRM for our small sales team. What would you recommend?", analysisIntent: "high_intent", buyerLanguage: ["Looking for the best CRM"], audienceSignals: ["small sales team"], specificity: 0.78 },
  { name: "clear feature requirement", expected: "qualified_or_high_confidence", body: "We need a CRM with SSO and reliable API integrations before our company can adopt it.", analysisIntent: "high_intent", painThemes: ["missing SSO"], buyerLanguage: ["We need a CRM with SSO"], audienceSignals: ["our company"], specificity: 0.88 },
  { name: "purchase and vendor evaluation", expected: "qualified_or_high_confidence", body: "Our company is evaluating CRM vendors and pricing for a replacement this quarter.", analysisIntent: "high_intent", buyerLanguage: ["evaluating CRM vendors"], audienceSignals: ["our company"], specificity: 0.8 },
  { name: "pricing objection causes switching", expected: "qualified_or_high_confidence", body: "HubSpot raised prices again, so we're replacing it with a simpler CRM for our 8-person team.", analysisIntent: "switching_intent", painThemes: ["price increase"], buyerLanguage: ["we're replacing it"], audienceSignals: ["8-person team"], specificity: 0.9 },
  { name: "clear unmet need", expected: "qualified_or_high_confidence", body: "I need a CRM that keeps follow-ups visible across our sales team; our current workflow loses leads.", analysisIntent: "high_intent", painThemes: ["lost leads", "follow-up visibility"], buyerLanguage: ["I need a CRM"], audienceSignals: ["sales team"], specificity: 0.88 },
  { name: "specific operational pain", expected: "qualified_or_high_confidence", body: "Our sales team spends four hours every week manually reconciling CRM reports and needs a better workflow.", analysisIntent: "problem_signal", painThemes: ["manual reporting", "reconciliation"], buyerLanguage: ["Our sales team"], audienceSignals: ["sales team"], specificity: 0.9 },
  { name: "short explicit demand", expected: "qualified_or_high_confidence", body: "Need a cheaper HubSpot alternative for 5 people.", analysisIntent: "alternative_search", buyerLanguage: ["Need a cheaper alternative"], audienceSignals: ["5 people"], specificity: 0.72 },
  { name: "strong demand with low engagement", expected: "qualified_or_high_confidence", body: "We are replacing Salesforce because it is too complex for our 8-person team; what simpler CRM should we evaluate?", sourceKey: "x", analysisIntent: "switching_intent", painThemes: ["complexity"], buyerLanguage: ["we are replacing Salesforce"], audienceSignals: ["8-person team"], specificity: 0.94, metadata: { publicMetrics: { like_count: 2, reply_count: 0, retweet_count: 0 } } },
  { name: "generic complaint", expected: "weak_or_rejected", body: "HubSpot sucks.", analysisIntent: "problem_signal", painThemes: [], specificity: 0.1, confidence: 0.5 },
  { name: "generic praise", expected: "weak_or_rejected", body: "Love Notion.", analysisIntent: "informational", specificity: 0.05, confidence: 0.5 },
  { name: "generic brand mention", expected: "weak_or_rejected", body: "HubSpot CRM.", analysisIntent: "informational", specificity: 0.05, confidence: 0.4 },
  { name: "viral meme", expected: "weak_or_rejected", body: "When your CRM says everything is fine 😂 meme", sourceKey: "x", analysisIntent: "informational", specificity: 0.08, confidence: 0.45, metadata: { publicMetrics: { like_count: 500000, reply_count: 20000, retweet_count: 50000 } } },
  { name: "news headline", expected: "weak_or_rejected", title: "News: Company launches a new CRM", body: "Company launches a new CRM today.", analysisIntent: "informational", specificity: 0.1, confidence: 0.5 },
  { name: "founder promotion", expected: "weak_or_rejected", body: "We launched the best CRM. Sign up now for a free demo!", analysisIntent: "high_intent", specificity: 0.2, confidence: 0.6 },
  { name: "affiliate spam", expected: "weak_or_rejected", body: "Use my affiliate referral code for a CRM discount and earn rewards.", analysisIntent: "informational", specificity: 0.2, confidence: 0.5 },
  { name: "giveaway", expected: "weak_or_rejected", body: "CRM giveaway! Enter now to win a lifetime account.", analysisIntent: "informational", specificity: 0.15, confidence: 0.4 },
  { name: "bot repetition", expected: "weak_or_rejected", body: "Best CRM deals available. Click here.", analysisIntent: "informational", specificity: 0.15, confidence: 0.4, metadata: { isBot: true, repetitive: true } },
  { name: "link only", expected: "weak_or_rejected", body: "https://example.com/crm", analysisIntent: "informational", specificity: 0.05, confidence: 0.3 },
  { name: "unrelated keyword overlap", expected: "weak_or_rejected", body: "The political article mentions CRM, but there is no product need here.", analysisIntent: "informational", specificity: 0.12, confidence: 0.4, matchConfidence: 0.15, matchDecision: "rejected" },
  { name: "duplicate repost", expected: "weak_or_rejected", body: "Looking for a CRM alternative to HubSpot.", analysisIntent: "alternative_search", specificity: 0.7, metadata: { isRetweet: true } },
  { name: "vague reply", expected: "weak_or_rejected", body: "same here", analysisIntent: "unknown", specificity: 0.05, confidence: 0.2, metadata: { isReply: true } },
  { name: "local relevant discussion", expected: "qualified_or_high_confidence", body: "Looking for a dentist in Hoorn who can handle anxious patients.", profileKind: "local_dentist", analysisIntent: "recommendation_request", buyerLanguage: ["Looking for a dentist"], specificity: 0.8 },
  { name: "local geographic mismatch", expected: "weak_or_rejected", body: "Looking for a dentist in Sydney.", profileKind: "local_dentist", analysisIntent: "recommendation_request", buyerLanguage: ["Looking for a dentist"], specificity: 0.75 },
];
