/**
 * Provider-agnostic LLM adapter for the homepage chat endpoint (Phase 2).
 *
 * Targets the OpenAI-compatible `/chat/completions` API shape, which Mistral
 * (the EU/GDPR default), OpenAI, and Azure OpenAI all speak. Switching provider
 * is an env-var change (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`,
 * `LLM_BASE_URL`) — no code change.
 *
 * Streaming is parsed from Server-Sent Events; text deltas are forwarded to the
 * caller via `onToken`, while tool calls are accumulated and returned so the
 * caller (chatAgent) can run a tool-calling loop.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sampling temperature, or null to omit (some models reject non-default). */
  temperature: number | null;
}

export interface CompletionResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  /** Best-effort token usage (provider-reported when available). */
  usage?: { promptTokens?: number; completionTokens?: number };
}

function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "mistral":
    default:
      return "https://api.mistral.ai/v1";
  }
}

function defaultModel(provider: string): string {
  switch (provider) {
    case "openai":
      return "gpt-5-mini";
    case "mistral":
    default:
      return "mistral-large-latest";
  }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Resolve the API key. A provider-specific var (MISTRAL_API_KEY / OPENAI_API_KEY
 * / AZURE_OPENAI_API_KEY) wins, so multiple keys can stay configured and
 * switching provider is just a change to LLM_PROVIDER. Falls back to the generic
 * LLM_API_KEY.
 */
function resolveApiKey(provider: string): string {
  const perProvider =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "azure"
        ? process.env.AZURE_OPENAI_API_KEY
        : provider === "mistral"
          ? process.env.MISTRAL_API_KEY
          : undefined;
  return perProvider || process.env.LLM_API_KEY || "";
}

/**
 * Resolve sampling temperature. Default 0.2. Set LLM_TEMPERATURE to a number to
 * override, or to "none"/"default"/empty to omit it entirely — needed for
 * OpenAI reasoning models (gpt-5 family) that only accept the default value.
 */
function resolveTemperature(): number | null {
  const raw = process.env.LLM_TEMPERATURE;
  if (raw === undefined) return 0.2;
  const t = raw.trim().toLowerCase();
  if (t === "" || t === "none" || t === "default") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0.2;
}

export function resolveProvider(): ProviderConfig {
  const provider = (process.env.LLM_PROVIDER || "mistral").toLowerCase();
  return {
    provider,
    apiKey: resolveApiKey(provider),
    model: process.env.LLM_MODEL || defaultModel(provider),
    baseUrl: trimSlash(process.env.LLM_BASE_URL || defaultBaseUrl(provider)),
    temperature: resolveTemperature(),
  };
}

export function isLlmConfigured(): boolean {
  return Boolean(resolveProvider().apiKey);
}

/** Accumulates streamed tool-call deltas keyed by their stream index. */
interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

function authHeaders(cfg: ProviderConfig): Record<string, string> {
  // Azure OpenAI uses an `api-key` header; everyone else uses Bearer.
  if (cfg.provider === "azure") {
    return { "api-key": cfg.apiKey };
  }
  return { Authorization: `Bearer ${cfg.apiKey}` };
}

/**
 * Stream one chat completion. Forwards assistant text deltas to `onToken` and
 * returns the full content plus any accumulated tool calls.
 */
export async function streamChatCompletion(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  tools: LlmTool[] | undefined,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (cfg.temperature !== null) {
    body.temperature = cfg.temperature;
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders(cfg),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `LLM request failed (${res.status}): ${detail.slice(0, 500)}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  const toolCalls = new Map<number, PartialToolCall>();
  let usage: CompletionResult["usage"];

  const handleEvent = (payload: string): void => {
    if (payload === "[DONE]") return;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const obj = json as {
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        finish_reason?: string | null;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (obj.usage) {
      usage = {
        promptTokens: obj.usage.prompt_tokens,
        completionTokens: obj.usage.completion_tokens,
      };
    }
    const choice = obj.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      onToken(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const existing =
          toolCalls.get(idx) ?? { id: "", name: "", arguments: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) {
          existing.arguments += tc.function.arguments;
        }
        toolCalls.set(idx, existing);
      }
    }
  };

  // SSE frames are separated by blank lines; each frame has `data:` lines.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          handleEvent(trimmed.slice(5).trim());
        }
      }
    }
  }

  const orderedToolCalls: ChatToolCall[] = Array.from(toolCalls.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({
      id: tc.id || `call_${tc.name}`,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments || "{}" },
    }));

  return { content, toolCalls: orderedToolCalls, finishReason, usage };
}
