import type { JsonObject } from "../../db/database.helpers";

export type StructuredGenerationRequest = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  promptVersion?: string;
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type StructuredGenerationResult<T> = {
  value: T;
  provider: string;
  model: string;
  promptVersion: string;
  usage?: JsonObject;
};

export interface StructuredLlmProvider {
  generateStructured<T>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>>;
}
