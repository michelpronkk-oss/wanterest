import type { DemandMapConcept, DemandMapResolvedMember } from "../demand-intelligence/demand-map.policy";
import { DemandCurrentnessService } from "../demand-intelligence/demand-currentness.service";
import { buildDemandMap } from "../demand-intelligence/demand-map.policy";
import type { DemandClusteringRepository } from "../demand-intelligence/demand-clustering.repository";
import type { IntelligenceRepository } from "../intelligence/intelligence.repository";
import { extractGeoEvidence, publicGeoEvidence } from "./geo-enrichment";
import { geoEvidenceSchema, type GeoPublicLocation } from "./geo.schemas";
import { buildCurrentGeography, conceptScopedCurrentMembers, productWideCurrentMembers, type CurrentGeographyMember, type CurrentGeographyReadModel } from "./current-geography.policy";

function locationFor(sourceKey: string, metadata: unknown, language: string | null | undefined): GeoPublicLocation {
  const evidence = extractGeoEvidence({ sourceKey, metadata, language });
  const parsed = geoEvidenceSchema.safeParse(evidence);
  return parsed.success ? (publicGeoEvidence(parsed.data) as GeoPublicLocation) : { countryCode: null, countryName: null, regionCode: null, regionName: null, city: null, confidence: "unknown", evidenceType: "unknown" };
}

/**
 * Wanterest Layer 9D: current, lifecycle-aware Geography. Reuses
 * DemandCurrentnessService/buildDemandMap unchanged for currentness, and the
 * existing geo evidence extraction unchanged for location — this service
 * only resolves conversation -> source item -> geo and applies the
 * product-wide/concept-scoped dedupe (docs/architecture.md §19). No provider
 * or LLM calls; no persistence.
 */
export class CurrentGeographyService {
  private readonly currentness: DemandCurrentnessService;

  constructor(private readonly clustering: DemandClusteringRepository, private readonly intelligence: IntelligenceRepository) {
    this.currentness = new DemandCurrentnessService(clustering);
  }

  private async resolveMembers(members: DemandMapResolvedMember[]): Promise<CurrentGeographyMember[]> {
    if (!members.length) return [];
    const conversationIds = [...new Set(members.map((member) => member.conversationId))];
    const conversations = await this.intelligence.listConversations(conversationIds);
    const conversationById = new Map(conversations.map((row) => [row.id, row]));
    const sourceItemIds = [...new Set(conversations.map((row) => row.primary_source_item_id).filter((id): id is string => Boolean(id)))];
    const sourceItems = await this.intelligence.listSourceItems(sourceItemIds);
    const sourceItemById = new Map(sourceItems.map((row) => [row.id, row]));
    const resolved: CurrentGeographyMember[] = [];
    for (const member of members) {
      const conversation = conversationById.get(member.conversationId);
      const source = conversation ? sourceItemById.get(conversation.primary_source_item_id) : undefined;
      const location = source ? locationFor(source.source_key, source.metadata, source.language) : { countryCode: null, countryName: null, regionCode: null, regionName: null, city: null, confidence: "unknown" as const, evidenceType: "unknown" as const };
      resolved.push({ member, location, excerpt: conversation?.body?.slice(0, 320) ?? "" });
    }
    return resolved;
  }

  private async currentConcepts(workspaceId: string, productId: string, now: Date): Promise<{ concepts: DemandMapConcept[]; diagnostics: CurrentGeographyReadModel["diagnostics"]; clusteringVersion: string }> {
    const { clusters, members, staleBefore, statesRead, statesTruncated } = await this.currentness.getCurrentness({ workspaceId, productId, now });
    const map = buildDemandMap({ clusters, members, buyerLanguage: [], legacy: null, now, staleBefore, statesRead, statesTruncated });
    return {
      concepts: map.current,
      diagnostics: { clustersRead: clusters.length, membershipsRead: members.length, statesRead, statesTruncated },
      clusteringVersion: map.clusteringVersion,
    };
  }

  /** Product-wide by default (a conversation counts once even if it evidences multiple concepts); pass anchorConceptKey to scope to one concept instead. */
  async getCurrentGeography(input: { workspaceId: string; productId: string; anchorConceptKey?: string; now?: Date }): Promise<CurrentGeographyReadModel> {
    const now = input.now ?? new Date();
    const { concepts, diagnostics, clusteringVersion } = await this.currentConcepts(input.workspaceId, input.productId, now);
    const dedupedMembers = input.anchorConceptKey
      ? conceptScopedCurrentMembers(concepts.find((concept) => concept.identity.anchorConceptKey === input.anchorConceptKey))
      : productWideCurrentMembers(concepts);
    const resolved = await this.resolveMembers(dedupedMembers);
    return buildCurrentGeography({ members: resolved, clusteringVersion, generatedAt: now, anchorConceptKey: input.anchorConceptKey ?? null, diagnostics });
  }
}
