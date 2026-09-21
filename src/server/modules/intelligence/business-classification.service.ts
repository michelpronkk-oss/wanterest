import type { ProductRow, ProductSnapshotRow } from "../../db/database.helpers";
import { BUSINESS_CLASSIFICATION_VERSION, FixtureBusinessClassificationEngine, type BusinessClassificationEngine, type BusinessClassificationInput } from "./business-classification.engines";
import { businessClassificationSchema, type BusinessClassification } from "./business-classification.schemas";
import { normalizeBusinessClassification } from "./business-classification.normalizer";

export type BusinessClassificationReadModel = Pick<BusinessClassification, "business_type" | "business_model" | "market_scope" | "technical_orientation" | "primary_category" | "location_dependency" | "classification_version">;

export type ClassifyProductBusinessInput = BusinessClassificationInput & {
  product?: Pick<ProductRow, "id" | "name" | "website_url">;
};

export async function classifyProductBusiness(
  input: ClassifyProductBusinessInput,
  engine: BusinessClassificationEngine = new FixtureBusinessClassificationEngine(),
  engineVersionId?: string | null,
): Promise<BusinessClassification> {
  const generated = await engine.classify({
    productName: input.product?.name ?? input.productName,
    websiteUrl: input.product?.website_url ?? input.websiteUrl ?? null,
    snapshotText: input.snapshotText,
    sourceReference: input.sourceReference,
  });
  const normalized = normalizeBusinessClassification(generated.output, {
    version: engine.version || BUSINESS_CLASSIFICATION_VERSION,
    engineVersionId,
    provider: generated.provider,
    model: generated.model,
    promptVersion: generated.promptVersion,
  });
  if (!normalized.evidence.length) throw new Error("Business classification returned no evidence.");
  return normalized;
}

export async function tryClassifyProductBusiness(
  input: ClassifyProductBusinessInput,
  engine: BusinessClassificationEngine = new FixtureBusinessClassificationEngine(),
  engineVersionId?: string | null,
): Promise<BusinessClassification | null> {
  try {
    return await classifyProductBusiness(input, engine, engineVersionId);
  } catch {
    return null;
  }
}

export function readBusinessClassification(snapshot: ProductSnapshotRow): BusinessClassification | null {
  const metadata = snapshot.metadata && typeof snapshot.metadata === "object" && !Array.isArray(snapshot.metadata) ? snapshot.metadata as Record<string, unknown> : {};
  const result = businessClassificationSchema.safeParse(metadata.business_classification);
  return result.success ? result.data : null;
}

export function readBusinessClassificationModel(snapshot: ProductSnapshotRow): BusinessClassificationReadModel | null {
  const classification = readBusinessClassification(snapshot);
  if (!classification) return null;
  return {
    business_type: classification.business_type,
    business_model: classification.business_model,
    market_scope: classification.market_scope,
    technical_orientation: classification.technical_orientation,
    primary_category: classification.primary_category,
    location_dependency: classification.location_dependency,
    classification_version: classification.classification_version,
  };
}
