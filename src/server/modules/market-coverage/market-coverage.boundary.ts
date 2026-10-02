import "server-only";

import { normalizedConnectorEnvelopeSchema, type GlobalCoverageObservation, globalCoverageObservationSchema } from "./market-coverage.contracts";
import type { MarketCoveragePartitionIdentity } from "./market-coverage.identity";

export type GlobalCoverageProjection =
  | { eligible: true; observation: GlobalCoverageObservation }
  | { eligible: false; reason: "workspace_private" | "slice_mismatch" };

/** Explicitly gates metadata-only coverage linking; it never copies body/raw provider content. */
export function projectGlobalCoverageObservation(input: {
  envelope: unknown;
  partition: MarketCoveragePartitionIdentity;
  conversationId: string;
  sourceItemId: string;
  observedAt: string;
}): GlobalCoverageProjection {
  const envelope = normalizedConnectorEnvelopeSchema.parse(input.envelope);
  if (envelope.visibility === "workspace_private") return { eligible: false, reason: "workspace_private" };
  if (envelope.sourceFamily !== input.partition.dimensions.sourceFamily
      || (input.partition.dimensions.geographyCode !== null && envelope.geography?.code !== input.partition.dimensions.geographyCode)
      || (input.partition.dimensions.languageCode !== null && envelope.languageCode !== input.partition.dimensions.languageCode)
      || (input.partition.dimensions.surfaceSubtype !== null && envelope.surfaceSubtype !== input.partition.dimensions.surfaceSubtype)) {
    return { eligible: false, reason: "slice_mismatch" };
  }
  const observation = globalCoverageObservationSchema.parse({
    partitionKey: input.partition.partitionKey,
    conversationId: input.conversationId,
    sourceItemId: input.sourceItemId,
    sourceFamily: envelope.sourceFamily,
    providerKey: envelope.providerKey,
    evidenceRole: envelope.evidenceRole,
    observedAt: input.observedAt,
    geographyCode: envelope.geography?.code ?? null,
    geographyConfidence: envelope.geography?.confidence ?? null,
    languageCode: envelope.languageCode,
    surfaceSubtype: envelope.surfaceSubtype,
    rightsProfileReference: envelope.rightsProfileReference,
    retentionClassReference: envelope.retentionClassReference,
    publicProjectionEligibility: envelope.publicProjectionEligibility,
  });
  return { eligible: true, observation };
}
