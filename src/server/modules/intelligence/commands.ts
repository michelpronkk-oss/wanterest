import "server-only";

import { requireUser } from "../auth";
import { getProductQuery } from "../products";
import { workspaceIdSchema } from "../products/product.schemas";
import { AppError } from "../../lib/errors";
import { createSupabaseServerClient } from "../../providers/supabase/server";
import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { SupabaseIntelligenceRepository } from "./intelligence.repository";
import { IntelligenceService } from "./intelligence.service";
import { FixtureConversationAnalysisEngine, FixtureDemandProfileEngine, FixtureProductMatchingEngine } from "./engines";

function service() {
  return new IntelligenceService(new SupabaseIntelligenceRepository(createSupabaseServiceClient()));
}

export async function captureManualProductSnapshotCommand(workspaceId: unknown, productId: unknown, rawText: string, sourceUrl?: string | null) {
  const product = await getProductQuery(workspaceId, productId);
  return service().createSnapshot(product, { pageType: "manual", rawText, sourceUrl });
}

export async function generateDemandProfileCommand(workspaceId: unknown, productId: unknown, engineVersionId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().generateDemandProfile(product, engineVersionId, new FixtureDemandProfileEngine());
}

export async function analyzeConversationJob(conversationId: string, sourceItemId: string, engineVersionId: string) {
  const repository = new SupabaseIntelligenceRepository(createSupabaseServiceClient());
  const conversation = await repository.getConversation(conversationId);
  const sourceItem = await repository.getSourceItem(sourceItemId);
  if (!conversation || !sourceItem) throw new Error("Conversation source evidence was not found.");
  return new IntelligenceService(repository).analyzeConversation(conversation, sourceItem, engineVersionId, new FixtureConversationAnalysisEngine());
}

export async function matchProductJob(workspaceId: unknown, productId: unknown, profileId: string, analysisId: string, engineVersionId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().matchProduct(product, profileId, analysisId, engineVersionId, new FixtureProductMatchingEngine());
}

export async function rankMatchJob(workspaceId: unknown, productId: unknown, evaluationId: string, rankingEngineVersionId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().rankEvaluation(product, evaluationId, rankingEngineVersionId);
}

export async function refreshSignalJob(workspaceId: unknown, productId: unknown, evaluationId: string, rankingId: string) {
  const product = await getProductQuery(workspaceId, productId);
  return service().materializeSignal(product, evaluationId, rankingId);
}

export async function addMatchFeedbackCommand(input: Parameters<IntelligenceService["addFeedback"]>[0]) {
  const user = await requireUser();
  return service().addFeedback({ ...input, actorUserId: user.id });
}

export async function listSignalsQuery(workspaceId: unknown, productId: unknown, filters?: Parameters<IntelligenceService["listSignals"]>[2]) {
  const product = await getProductQuery(workspaceId, productId);
  return service().listSignals(product.workspace_id, product.id, filters);
}

export async function getSignalQuery(workspaceId: unknown, signalId: string) {
  await requireUser();
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("signals").select("product_id").eq("workspace_id", workspace.data).eq("id", signalId).maybeSingle();
  if (error || !data) throw new Error("Signal was not found.");
  const product = await getProductQuery(workspace.data, data.product_id);
  return service().getSignal(product.workspace_id, signalId);
}

export async function setSignalLifecycleCommand(workspaceId: unknown, signalId: string, lifecycleStatus: "active" | "saved" | "dismissed" | "archived") {
  await requireUser();
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!workspace.success) throw new AppError("VALIDATION_ERROR", "Invalid workspace identifier.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("set_signal_lifecycle", { p_workspace_id: workspace.data, p_signal_id: signalId, p_lifecycle_status: lifecycleStatus });
  if (error || !data) throw new Error("Signal lifecycle could not be updated.");
  return data;
}
