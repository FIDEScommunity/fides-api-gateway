/**
 * Tool-calling chat orchestration for the FIDES homepage assistant (Phase 2).
 *
 * Runs an LLM tool-calling loop that answers questions about the FIDES
 * Ecosystem Explorer (wallets, credential types, organizations, issuers,
 * relying parties) using the *same* tool layer as the MCP server — exposed here
 * through `buildToolRegistry()`. The model may only answer from tool results;
 * the system prompt enforces grounding and canonical linking.
 */

import { buildToolRegistry, type ToolRegistry } from "./toolRegistry";
import {
  type ChatMessage,
  type CompletionResult,
  type LlmTool,
  type ProviderConfig,
  resolveProvider,
  streamChatCompletion,
} from "./llm";

const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `You are the FIDES Ecosystem Explorer assistant, embedded on the FIDES Community website.

You help visitors explore the FIDES catalogs:
- wallets (digital identity wallets),
- credential types,
- organizations,
- issuers (who issues which credentials),
- relying parties (who requests credentials).

Rules:
- Answer ONLY from the data returned by the tools. Never invent wallets, issuers, organizations, credentials, URLs, or facts. If the tools return nothing relevant, say so plainly and suggest how to refine the question.
- Before answering a factual question, call the appropriate tool(s) first. Do not write any prose before your tool calls in a turn that needs data.
- Prefer the catalog-specific tools (search_wallets, search_issuers, search_organizations, search_credential_types, search_rps and their get_* counterparts) when the catalog is clear; use the generic search/fetch tools only for broad cross-catalog questions.
- Make item names clickable. Link each item inline using markdown where the visible label is the item's NAME (or its id), e.g. [National EUDI Wallet (MyGov.be)](url) or [cred:eu:pid-mdoc:mdoc](url). The url is the tool's detailUrl / url field. NEVER show a bare or raw URL as the visible link text — the label must always be human-readable. The interface also lists these as source cards below your answer.
- Keep answers concise and scannable. Use short paragraphs or bullet lists. For lists of items, put the linked item name (and a brief qualifier) on each line.
- Reply in the language of the user's question (Dutch or English). Do not translate proper names, ids, or technical field values.
- You cannot perform write actions; this is a read-only explorer.`;

/**
 * Appended to the system prompt only when the WordPress site-content tool is
 * registered (CHAT_SITE_CONTENT_ENABLED != 0). Keeps the catalog-only behaviour
 * unchanged when the kill switch is flipped.
 */
const SITE_CONTENT_RULE = `
- For conceptual or general questions that the catalogs do not answer — definitions (e.g. "what is a business wallet"), what FIDES is, the manifesto, use cases, news or events — call \`search_site_content\` and answer from the returned page text. Cite the relevant page with a markdown link using its title as the visible label. Still never invent facts: if nothing relevant comes back, say so.`;

export interface ChatSource {
  title: string;
  url: string;
  type?: string;
}

export interface ChatTurnCallbacks {
  onToken: (text: string) => void;
  onSources?: (sources: ChatSource[]) => void;
}

export interface ChatTurnResult {
  text: string;
  sources: ChatSource[];
  approxTokens: number;
}

export interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

function approxTokensFromUsage(
  usage: CompletionResult["usage"],
  fallbackChars: number,
): number {
  if (usage && (usage.promptTokens || usage.completionTokens)) {
    return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  }
  // Rough heuristic when the provider does not report usage on a stream.
  return Math.ceil(fallbackChars / 4);
}

/** Walk an arbitrary tool-result JSON value and collect citable sources. */
function collectSources(value: unknown, into: Map<string, ChatSource>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectSources(v, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const url =
    typeof obj.detailUrl === "string"
      ? obj.detailUrl
      : typeof obj.url === "string"
        ? obj.url
        : undefined;
  if (url && !into.has(url)) {
    const title =
      (typeof obj.title === "string" && obj.title) ||
      (typeof obj.name === "string" && obj.name) ||
      (typeof obj.displayName === "string" && obj.displayName) ||
      (typeof obj.legalName === "string" && obj.legalName) ||
      // Credential types have no display name; their id (e.g.
      // "cred:eu:pid-mdoc:mdoc") is far more readable than the raw URL.
      (typeof obj.id === "string" && obj.id) ||
      url;
    const type =
      typeof obj.type === "string"
        ? obj.type
        : obj.metadata &&
            typeof obj.metadata === "object" &&
            typeof (obj.metadata as Record<string, unknown>).type === "string"
          ? ((obj.metadata as Record<string, unknown>).type as string)
          : undefined;
    into.set(url, { title: String(title), url, type });
  }
  for (const v of Object.values(obj)) collectSources(v, into);
}

function buildTools(registry: ToolRegistry): LlmTool[] {
  return registry.list().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Run a single assistant turn: stream the answer to `callbacks.onToken`, run
 * any tool calls against the shared registry, and return the final text and the
 * citable sources gathered from tool results.
 */
export async function runChatTurn(
  messages: IncomingMessage[],
  callbacks: ChatTurnCallbacks,
  options?: { provider?: ProviderConfig; signal?: AbortSignal },
): Promise<ChatTurnResult> {
  const provider = options?.provider ?? resolveProvider();
  const registry = buildToolRegistry();
  const tools = buildTools(registry);

  const siteContentEnabled = registry
    .list()
    .some((t) => t.name === "search_site_content");
  const systemContent = siteContentEnabled
    ? SYSTEM_PROMPT + SITE_CONTENT_RULE
    : SYSTEM_PROMPT;

  const convo: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const sources = new Map<string, ChatSource>();
  let finalText = "";
  let approxChars = 0;
  let approxTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;
    const result = await streamChatCompletion(
      provider,
      convo,
      // On the final allowed round, drop tools to force a text answer.
      isLastRound ? undefined : tools,
      callbacks.onToken,
      options?.signal,
    );

    approxChars += result.content.length;
    approxTokens += approxTokensFromUsage(result.usage, result.content.length);

    if (result.toolCalls.length === 0 || isLastRound) {
      finalText += result.content;
      break;
    }

    // Record the assistant's tool-call message, then execute each tool.
    convo.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const toolResult = await registry.call(call.function.name, args);
      const text = toolResult.content.map((c) => c.text).join("\n");
      approxChars += text.length;

      try {
        collectSources(JSON.parse(text), sources);
      } catch {
        /* tool result was not JSON; nothing to cite */
      }

      convo.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: text,
      });
    }
  }

  const sourceList = Array.from(sources.values());
  if (callbacks.onSources && sourceList.length > 0) {
    callbacks.onSources(sourceList);
  }

  return {
    text: finalText,
    sources: sourceList,
    approxTokens: approxTokens || Math.ceil(approxChars / 4),
  };
}
