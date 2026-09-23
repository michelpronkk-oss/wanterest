import type { Json } from "@/server/db/database.helpers";
import type {
  DemandDirection,
  DemandTargetType,
  SpeakerRole,
} from "./signal-qualification.schemas";

export type DirectionalDemand = {
  demand_direction: DemandDirection;
  demand_target_type: DemandTargetType;
  demand_target_name: string | null;
  source_products: string[];
  speaker_role: SpeakerRole;
  positive_for_product: boolean | null;
  host_product_context: boolean;
};

export type DirectionalDemandInput = {
  productName: string;
  title: string | null | undefined;
  body: string;
  sourceKey: string;
  sourceMetadata: Json;
  knownProducts: string[];
  category: string | undefined;
};

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function metadataValue(metadata: Json, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, Json>)[key];
  return typeof value === "string" && text(value) ? text(value) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionPattern(name: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(name)}(?:$|[^A-Za-z0-9])`, "i");
}

function knownNames(input: DirectionalDemandInput): string[] {
  const metadataRepository = metadataValue(input.sourceMetadata, "repositoryName") ?? metadataValue(input.sourceMetadata, "repository");
  const repositoryName = metadataRepository?.split("/").at(-1) ?? null;
  const displayRepositoryName = repositoryName ? `${repositoryName.charAt(0).toUpperCase()}${repositoryName.slice(1)}` : null;
  return [...new Set([input.productName, ...input.knownProducts, displayRepositoryName].filter((value): value is string => Boolean(value && text(value))).map(text))]
    .sort((left, right) => right.length - left.length);
}

function namesIn(textValue: string, names: string[]): string[] {
  return names.filter((name) => mentionPattern(name).test(textValue));
}

function destinationFor(textValue: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const patterns = [
      new RegExp(`\\b(?:move|moving|migrate|migrating|switch|switching)\\s+(?:away\\s+)?(?:from\\s+[^.!?]{0,100}\\s+)?to\\s+${escaped}\\b`, "i"),
      new RegExp(`\\b(?:replace|replacing)\\b[^.!?]{0,100}\\bwith\\s+${escaped}\\b`, "i"),
      new RegExp(`\\b(?:set(?:ting)?\\s+up|create|creating)\\s+(?:a|an|the)(?:\\s+new)?\\s+${escaped}\\s+(?:workspace|project|account)\\b`, "i"),
      new RegExp(`\\b(?:evaluate|evaluating|consider|considering|assess|assessing)\\s+${escaped}\\s+as\\s+(?:a|an)\\s+[^.!?]{0,80}\\b(?:alternative|replacement)\\b`, "i"),
    ];
    if (patterns.some((pattern) => pattern.test(textValue))) return name;
  }
  return null;
}

function sourceNamesFor(textValue: string, names: string[], destination: string | null, excludedNames: string[] = []): string[] {
  const clauses = [
    ...[...textValue.matchAll(/\b(?:leave|leaving|migrat(?:e|ing)\s+from|switch(?:ing)?\s+from|alternative(?:s)?\s+(?:to|for)|replace|replacing|replacement\s+for|parity\s+with|from)\b[^.!?]{0,160}/gi)].map((match) => match[0]),
    ...[...textValue.matchAll(/\b[^.!?]{0,80}\b(?:alternative|alternatives|replacement)\b/gi)].map((match) => match[0]),
    ...[...textValue.matchAll(/\b[^.!?]{0,80}\b(?:like|similar\s+to)\b[^.!?]{0,80}/gi)].map((match) => match[0]),
  ];
  const sourceNames = namesIn(clauses.join(" "), names);
  const genericSystems = [...textValue.matchAll(/\b(?:spreadsheet|spreadsheets|excel|csv)\b/gi)].map((match) => match[0]);
  return [...new Set([...sourceNames, ...genericSystems])].filter((name) => !destination || name.toLowerCase() !== destination.toLowerCase()).filter((name) => !excludedNames.some((excluded) => name.toLowerCase() === excluded.toLowerCase()));
}

function repositoryProduct(input: DirectionalDemandInput, names: string[]): string | null {
  if (input.sourceKey !== "github") return null;
  const repository = metadataValue(input.sourceMetadata, "repositoryName") ?? metadataValue(input.sourceMetadata, "repository");
  const rawName = repository?.split("/").at(-1) ?? null;
  const name = rawName ? `${rawName.charAt(0).toUpperCase()}${rawName.slice(1)}` : null;
  return name && names.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) ? names.find((candidate) => candidate.toLowerCase() === name.toLowerCase())! : name;
}

function hasHostProductContext(textValue: string, hostProduct: string | null, sourceProducts: string[], scannedProduct: string): boolean {
  if (!hostProduct || hostProduct.toLowerCase() === scannedProduct.toLowerCase() || sourceProducts.length === 0) return false;
  return /\b(?:alternative|alternatives|replacement|parity|roadmap|feature|features|like)\b/i.test(textValue);
}

function speakerRole(input: DirectionalDemandInput, textValue: string, positive: boolean | null): SpeakerRole {
  const authorAssociation = metadataValue(input.sourceMetadata, "authorAssociation")?.toLowerCase();
  if (authorAssociation && ["owner", "member", "collaborator", "maintainer"].includes(authorAssociation)) return "maintainer";
  if (positive !== null && /\b(?:i|we|our team|our company|my team)\b/i.test(textValue)) return "buyer";
  return "unknown";
}

export function deriveDirectionalDemand(input: DirectionalDemandInput): DirectionalDemand {
  const textValue = text(`${input.title ?? ""} ${input.body}`);
  const names = knownNames(input);
  const productName = input.productName;
  const destination = destinationFor(textValue, names);
  const repository = repositoryProduct(input, names);
  const sourceProducts = sourceNamesFor(textValue, names, destination, repository ? [repository] : []);
  const implementation = /\b(?:oauth|authentication|auth|api tokens?|access tokens?|credentials?|login|sign[- ]?in)\b/i.test(textValue)
    && (
      /\b(?:alternative|method)\b[^.!?]{0,80}\b(?:for|to)\b/i.test(textValue)
      || /\b(?:add|change|implement|support)\b[^.!?]{0,100}\b(?:oauth|authentication|auth|api tokens?|access tokens?|credentials?|login|sign[- ]?in)\b[^.!?]{0,100}\bintegration\b/i.test(textValue)
      || /\b(?:integration|implementation)\b[^.!?]{0,80}\b(?:alternative|change|switch)\b/i.test(textValue)
    );
  const featureRequest = /\b(?:needs?|requires?|wants?|should|must have|add|support|import(?:er|ing)?|bring|there is no way|missing|lacks?)\b/i.test(textValue);
  const productMentioned = namesIn(textValue, names).some((name) => name.toLowerCase() === productName.toLowerCase());
  const hostProductContext = hasHostProductContext(textValue, repository, sourceProducts, productName);

  let demand_direction: DemandDirection = "unknown";
  let demand_target_type: DemandTargetType = "unknown";
  let demand_target_name: string | null = null;
  let positive_for_product: boolean | null = null;

  if (implementation) {
    demand_direction = "contextual";
    demand_target_type = "implementation";
    demand_target_name = sourceProducts[0] ?? null;
    positive_for_product = false;
  } else if (destination) {
    demand_target_name = destination;
    if (destination.toLowerCase() === productName.toLowerCase()) {
      demand_direction = "toward_product";
      demand_target_type = "scanned_product";
      positive_for_product = true;
    } else {
      demand_direction = "away_from_product";
      demand_target_type = "third_party_product";
      positive_for_product = false;
    }
  } else if (hostProductContext) {
    demand_direction = "contextual";
    demand_target_type = "third_party_product";
    demand_target_name = repository;
    positive_for_product = false;
  } else if (repository && repository.toLowerCase() !== productName.toLowerCase() && featureRequest) {
    demand_direction = "contextual";
    demand_target_type = "third_party_product";
    demand_target_name = repository;
    positive_for_product = false;
  } else if (/\b(?:alternative(?:s)?|instead of|other options?)\b/i.test(textValue) && sourceProducts.length > 0) {
    demand_direction = "toward_category";
    demand_target_type = "category";
    demand_target_name = input.category ?? null;
    positive_for_product = true;
  } else if (productMentioned && /\b(?:need|needs|want|wants|looking for|evaluate|evaluating|buy|pricing|support|feature)\b/i.test(textValue)) {
    demand_direction = "toward_product";
    demand_target_type = "scanned_product";
    demand_target_name = productName;
    positive_for_product = true;
  }

  const role = speakerRole(input, textValue, positive_for_product);
  if (role === "unknown" && demand_target_type === "third_party_product") positive_for_product = false;
  return { demand_direction, demand_target_type, demand_target_name, source_products: sourceProducts, speaker_role: role, positive_for_product, host_product_context: hostProductContext };
}
