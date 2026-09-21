import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_OPENAI_MODEL, resolveLlmRuntimeConfig } from "../../src/server/providers/llm/config";
import { OpenAIChatStructuredLlmProvider, OpenAIProviderError } from "../../src/server/providers/llm/openai";

describe("OpenAI structured LLM provider", () => {
  it("selects OpenAI only when the server-only key is present", () => {
    expect(resolveLlmRuntimeConfig({})).toEqual({ provider: "fixture", model: "deterministic", apiKeyPresent: false });
    expect(resolveLlmRuntimeConfig({ openAiApiKey: "  " })).toEqual({ provider: "fixture", model: "deterministic", apiKeyPresent: false });
    expect(resolveLlmRuntimeConfig({ openAiApiKey: "redacted-key" })).toEqual({ provider: "openai", model: DEFAULT_OPENAI_MODEL, apiKeyPresent: true });
    expect(resolveLlmRuntimeConfig({ openAiApiKey: "redacted-key", openAiModel: "gpt-test" }).model).toBe("gpt-test");
  });

  it("sends bounded JSON-schema structured output requests and returns safe usage metadata", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const provider = new OpenAIChatStructuredLlmProvider({
      apiKey: "redacted-key",
      model: "gpt-test",
      fetchImpl: async (url, init) => {
        request = { url: String(url), init };
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ business_type: "developer_tool" }) } }],
          usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await provider.generateStructured<{ business_type: string }>({
      schemaName: "BusinessClassificationV1",
      promptVersion: "business-classification-v1",
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { type: "object", properties: { business_type: { type: "string" } } },
      maxOutputTokens: 900,
      temperature: 0,
    });

    const body = JSON.parse(String(request?.init?.body)) as { model: string; temperature: number; max_completion_tokens: number; response_format: { type: string; json_schema?: { name: string; strict: boolean } } };
    expect(request?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request?.init?.method).toBe("POST");
    expect((request?.init?.headers as Record<string, string>).Authorization).toBe("Bearer redacted-key");
    expect(body).toMatchObject({ model: "gpt-test", temperature: 0, max_completion_tokens: 900 });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "BusinessClassificationV1", strict: false } });
    expect(result).toMatchObject({ value: { business_type: "developer_tool" }, provider: "openai", model: "gpt-test", promptVersion: "business-classification-v1", usage: { total_tokens: 59 } });
  });

  it("retries bounded provider failures and exposes a sanitized failure kind", async () => {
    let calls = 0;
    const provider = new OpenAIChatStructuredLlmProvider({
      apiKey: "redacted-key",
      model: "gpt-test",
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "provider failure" } }), { status: 503 });
      },
    });

    await expect(provider.generateStructured({ schemaName: "DemandProfileV2", systemPrompt: "system", userPrompt: "user" })).rejects.toMatchObject({ kind: "failed", status: 503 } satisfies Partial<OpenAIProviderError>);
    expect(calls).toBe(2);
  });
});
