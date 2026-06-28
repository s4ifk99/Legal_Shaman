import type { OpenRouterChatResponse } from "./types";
import {
  openRouterDefaultHeaders,
  resolveChatModel,
  resolveLlmApiKey,
  resolveLlmBaseUrl,
} from "@/lib/llm/openrouter";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/** Same keys as `lib/llm/client.ts` — reads `web/.env.local` when scripts import `load-dotenv`. */
function resolveLlmApiKeyOrThrow(): string {
  const key = resolveLlmApiKey();
  if (!key) {
    throw new OpenRouterError(
      "Missing LLM_API_KEY (or OPENROUTER_API_KEY). Set LLM_API_KEY in web/.env.local — the same OpenRouter key used for /find-a-lawyer.",
    );
  }
  return key;
}

function chatCompletionsUrl(): string {
  return `${resolveLlmBaseUrl()}/chat/completions`;
}

/**
 * Extract JSON from an LLM response, tolerating markdown code fences.
 */
export function parseJsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new OpenRouterError("LLM returned empty message content");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim()) as unknown;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new OpenRouterError("LLM response was not valid JSON");
  }
}

/**
 * Call the configured OpenAI-compatible chat endpoint and parse JSON from the reply.
 */
export async function openRouterJsonCompletion(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<unknown> {
  const apiKey = resolveLlmApiKeyOrThrow();
  const resolvedModel =
    model?.trim() ||
    process.env.REDDIT_SEARCH_MODEL?.trim() ||
    process.env.LLM_SMALL_MODEL?.trim() ||
    resolveChatModel();

  let response: Response;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(openRouterDefaultHeaders() ?? {}),
    };
    response = await fetch(chatCompletionsUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (err) {
    throw new OpenRouterError(
      `LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = (await response.json()) as OpenRouterChatResponse;

  if (!response.ok) {
    throw new OpenRouterError(
      data.error?.message ?? `LLM HTTP ${response.status}`,
      response.status,
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new OpenRouterError("LLM response missing assistant content");
  }

  return parseJsonFromContent(content);
}
