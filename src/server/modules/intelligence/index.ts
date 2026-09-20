export { IntelligenceService } from "./intelligence.service";
export { InMemoryIntelligenceRepository } from "./intelligence.repository";
export { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine } from "./engines";
export { calculateOpportunityScore, freshnessScore, INTENT_STRENGTH, RANKING_FORMULA_VERSION, RANKING_WEIGHTS, SOURCE_QUALITY } from "./ranking";
export { conversationAnalysisSchema, demandProfileSchema, evidenceSpanSchema, feedbackTypeSchema, intentTypeSchema, productMatchResultSchema } from "./intelligence.schemas";
export type { DemandProfileEngine, ConversationAnalysisEngine, ProductMatchingEngine } from "./engines";
export type { FeedbackType, IntentType } from "./intelligence.schemas";
export type { SignalFilters, SignalReadModel } from "./intelligence.service";
export type { IntelligenceRepository } from "./intelligence.repository";
