import "server-only";

import type { JsonObject } from "../../db/database.helpers";
import type { StructuredGenerationRequest, StructuredGenerationResult, StructuredLlmProvider } from "./contracts";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ProviderFailureKind = "unavailable" | "failed";

export class OpenAIProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderFailureKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAIProviderError";
  }
}

type OpenAIProviderOptions = {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
};

function safeUsage(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const result: JsonObject = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_tokens_details", "completion_tokens_details"]) {
    const candidate = usage[key];
    if (typeof candidate === "number" || (candidate && typeof candidate === "object" && !Array.isArray(candidate))) {
      result[key] = candidate as JsonObject[string];
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function responseContent(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: unknown }).message : null;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { text: string } => Boolean(part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"))
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text || null;
  }
  return null;
}

function schemaName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "structured_output";
}

function shouldRetry(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

function developmentLog(input: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "production") console.info("[llm]", input);
}

export class OpenAIChatStructuredLlmProvider implements StructuredLlmProvider {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  }

  async generateStructured<T>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
    const startedAt = Date.now();
    const maxOutputTokens = Math.min(3_000, Math.max(256, request.maxOutputTokens ?? 1_200));
    const responseFormat = request.jsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: schemaName(request.schemaName),
            strict: false,
            schema: request.jsonSchema,
          },
        }
      : { type: "json_object" };
    const body = {
      model: this.options.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      temperature: request.temperature ?? 0,
      max_completion_tokens: maxOutputTokens,
      response_format: responseFormat,
    };

    let lastError: OpenAIProviderError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
      try {
        const response = await this.fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const error = new OpenAIProviderError(`OpenAI request returned HTTP ${response.status}.`, "failed", response.status);
          lastError = error;
          if (attempt < this.maxAttempts && shouldRetry(response.status)) {
            await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
            continue;
          }
          throw error;
        }
        const content = responseContent(payload);
        if (!content) throw new OpenAIProviderError("OpenAI returned no structured content.", "failed", response.status);
        let value: unknown;
        try {
          value = JSON.parse(content);
        } catch {
          throw new OpenAIProviderError("OpenAI returned invalid structured content.", "failed", response.status);
        }
        const usage = safeUsage(payload && typeof payload === "object" ? (payload as { usage?: unknown }).usage : undefined);
        developmentLog({
          provider: "openai",
          model: this.options.model,
          operation: request.schemaName,
          success: true,
          latencyMs: Date.now() - startedAt,
          tokenUsage: usage ?? null,
          fallbackUsed: false,
        });
        return {
          value: value as T,
          provider: "openai",
          model: this.options.model,
          promptVersion: request.promptVersion ?? request.schemaName,
          usage,
        };
      } catch (error) {
        if (error instanceof OpenAIProviderError) {
          lastError = error;
        } else {
          lastError = new OpenAIProviderError(error instanceof Error && error.name === "AbortError" ? "OpenAI request timed out." : "OpenAI request could not be completed.", "unavailable");
        }
        if (attempt < this.maxAttempts && shouldRetry(lastError.status)) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
          continue;
        }
        break;
      } finally {
        clearTimeout(timeout);
      }
    }

    developmentLog({
      provider: "openai",
      model: this.options.model,
      operation: request.schemaName,
      success: false,
      latencyMs: Date.now() - startedAt,
      tokenUsage: null,
      fallbackUsed: false,
      failureKind: lastError?.kind ?? "unavailable",
      status: lastError?.status ?? null,
    });
    throw lastError ?? new OpenAIProviderError("OpenAI request could not be completed.", "unavailable");
  }
}
