import "server-only";

import { z } from "zod";

import { AppError } from "@/server/lib/errors";
import { createShareCardService, type ShareCardService } from "./share-card.service";
import { intelligenceShareCardVariantSchema, shareCardEventInputSchema, shareCardMutationInputSchema, type ShareCardVariant } from "./share-card.schemas";

const uuidSchema = z.string().uuid();

function variant(input: unknown): ShareCardVariant {
  const parsed = shareCardMutationInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "The share-card action is invalid.", 422, { issues: parsed.error.issues });
  return parsed.data.variant;
}

export async function getApplicantShareCardsQuery(statusToken: unknown, service?: ShareCardService) {
  if (typeof statusToken !== "string" || !statusToken) throw new AppError("NOT_FOUND", "The private share-card status is unavailable.");
  return (service ?? createShareCardService()).getApplicantCards(statusToken);
}

export async function mutateApplicantShareCardCommand(statusToken: unknown, input: unknown, service?: ShareCardService) {
  if (typeof statusToken !== "string" || !statusToken) throw new AppError("NOT_FOUND", "The private share-card status is unavailable.");
  const parsed = shareCardMutationInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "The share-card action is invalid.", 422, { issues: parsed.error.issues });
  const owner = service ?? createShareCardService();
  return parsed.data.action === "publish"
    ? owner.publishApplicant(statusToken, parsed.data.variant)
    : owner.revokeApplicant(statusToken, parsed.data.variant);
}

export async function getWorkspaceShareCardsQuery(workspaceId: unknown, userId: string, service?: ShareCardService) {
  const parsed = uuidSchema.safeParse(workspaceId);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "The workspace ID is invalid.");
  return (service ?? createShareCardService()).getWorkspaceCards(parsed.data, userId);
}

export async function getWorkspaceIntelligenceShareCardQuery(workspaceId: unknown, userId: string, input: unknown, service?: ShareCardService) {
  const parsedWorkspace = uuidSchema.safeParse(workspaceId);
  if (!parsedWorkspace.success) throw new AppError("VALIDATION_ERROR", "The workspace ID is invalid.");
  const parsedInput = shareCardMutationInputSchema.safeParse({ action: "publish", ...(input && typeof input === "object" ? input : {}) });
  if (!parsedInput.success || !intelligenceShareCardVariantSchema.safeParse(parsedInput.data.variant).success || !parsedInput.data.productId || !parsedInput.data.sourceId) {
    throw new AppError("VALIDATION_ERROR", "The intelligence share-card identity is invalid.", 422);
  }
  return (service ?? createShareCardService()).getWorkspaceIntelligenceCard(parsedWorkspace.data, userId, {
    variant: parsedInput.data.variant as "SIGNAL" | "DEMAND_GAP" | "DEMAND_DRIFT",
    productId: parsedInput.data.productId,
    sourceId: parsedInput.data.sourceId,
  });
}

export async function mutateWorkspaceShareCardCommand(workspaceId: unknown, userId: string, input: unknown, service?: ShareCardService) {
  const parsedWorkspace = uuidSchema.safeParse(workspaceId);
  if (!parsedWorkspace.success) throw new AppError("VALIDATION_ERROR", "The workspace ID is invalid.");
  const parsedInput = shareCardMutationInputSchema.safeParse(input);
  if (!parsedInput.success) throw new AppError("VALIDATION_ERROR", "The share-card action is invalid.", 422, { issues: parsedInput.error.issues });
  const owner = service ?? createShareCardService();
  const intelligence = intelligenceShareCardVariantSchema.safeParse(parsedInput.data.variant);
  if (intelligence.success) {
    if (!parsedInput.data.productId || !parsedInput.data.sourceId) throw new AppError("VALIDATION_ERROR", "An intelligence card requires a product and source identifier.", 422);
    const cardInput = { variant: intelligence.data, productId: parsedInput.data.productId, sourceId: parsedInput.data.sourceId };
    return parsedInput.data.action === "publish"
      ? owner.publishWorkspaceIntelligence(parsedWorkspace.data, userId, cardInput)
      : owner.revokeWorkspaceIntelligence(parsedWorkspace.data, userId, cardInput);
  }
  return parsedInput.data.action === "publish"
    ? owner.publishWorkspace(parsedWorkspace.data, userId, parsedInput.data.variant)
    : owner.revokeWorkspace(parsedWorkspace.data, userId, parsedInput.data.variant);
}

export async function getPublicShareCardQuery(publicSlug: unknown, service?: ShareCardService) {
  if (typeof publicSlug !== "string" || !/^[A-Za-z0-9_-]{32,96}$/.test(publicSlug)) return null;
  return (service ?? createShareCardService()).getPublicCard(publicSlug);
}

export async function recordShareCardEventCommand(input: unknown, service?: ShareCardService) {
  const parsed = shareCardEventInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "The share-card event is invalid.", 422);
  await (service ?? createShareCardService()).recordEvent(parsed.data);
}

export { variant as parseShareCardVariant };
