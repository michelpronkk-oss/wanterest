import "server-only";

import { z } from "zod";

import { AppError } from "@/server/lib/errors";
import { createShareCardService, type ShareCardService } from "./share-card.service";
import { shareCardEventInputSchema, shareCardMutationInputSchema, type ShareCardVariant } from "./share-card.schemas";

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

export async function mutateWorkspaceShareCardCommand(workspaceId: unknown, userId: string, input: unknown, service?: ShareCardService) {
  const parsedWorkspace = uuidSchema.safeParse(workspaceId);
  if (!parsedWorkspace.success) throw new AppError("VALIDATION_ERROR", "The workspace ID is invalid.");
  const parsedInput = shareCardMutationInputSchema.safeParse(input);
  if (!parsedInput.success) throw new AppError("VALIDATION_ERROR", "The share-card action is invalid.", 422, { issues: parsedInput.error.issues });
  const owner = service ?? createShareCardService();
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
