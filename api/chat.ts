/**
 * Conversational interface endpoint for the FIDES homepage assistant (Phase 2).
 *
 * Fetch-style Web handler (same runtime style as api/mcp.ts) that runs a
 * tool-calling loop over the shared FIDES catalog tool layer and streams the
 * answer back as Server-Sent Events.
 *
 * Request:  POST /api/chat   { "messages": [{ "role": "user", "content": "..." }] }
 * Response: text/event-stream with events:
 *   - token   { "text": "..." }   incremental assistant text
 *   - sources { "sources": [{ "title", "url", "type" }] }  citable detail pages
 *   - done    {}
 *   - error   { "message": "..." }
 *
 * Public + read-only. Bounded by per-IP rate limiting and a daily token budget
 * (see lib/rateLimit.ts). The LLM provider key lives server-side only
 * (LLM_API_KEY) — never in WordPress or the browser.
 *
 * See docs/MCP-IMPLEMENTATION-PLAN.md → section 4.
 */

import {
  runChatTurn,
  type ChatSource,
  type IncomingMessage,
} from "../lib/chatAgent";
import { logChatEvent } from "../lib/chatLog";
import { trackEvent } from "../lib/matomo";
import { isLlmConfigured } from "../lib/llm";
import {
  checkDailyBudget,
  checkRateLimit,
  clientIp,
  recordTokenUsage,
} from "../lib/rateLimit";

export const runtime = "nodejs";

const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 4000;

function allowedOrigin(req: Request): string {
  const configured = (process.env.CHAT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get("origin") || "";
  if (configured.length === 0) return "*";
  if (origin && configured.includes(origin)) return origin;
  return configured[0]!;
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
  };
}

function jsonResponse(
  req: Request,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
      ...(extra ?? {}),
    },
  });
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

function parseMessages(raw: unknown): IncomingMessage[] | null {
  if (!raw || typeof raw !== "object") return null;
  const arr = (raw as { messages?: unknown }).messages;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const messages: IncomingMessage[] = [];
  for (const m of arr.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      const trimmed = content.slice(0, MAX_CHARS_PER_MESSAGE).trim();
      if (trimmed) messages.push({ role, content: trimmed });
    }
  }
  if (messages.length === 0) return null;
  if (messages[messages.length - 1]!.role !== "user") return null;
  return messages;
}

export async function POST(req: Request): Promise<Response> {
  const reqStart = performance.now();
  if (!isLlmConfigured()) {
    return jsonResponse(req, 503, {
      error: "Chat is not configured",
      hint: "Set LLM_API_KEY (and optionally LLM_PROVIDER / LLM_MODEL).",
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, 400, { error: "Invalid JSON body" });
  }

  const messages = parseMessages(payload);
  if (!messages) {
    return jsonResponse(req, 400, {
      error:
        "Body must be { messages: [{ role, content }] } ending with a user message.",
    });
  }

  const ip = clientIp(req);
  const tRate0 = performance.now();
  const rate = await checkRateLimit(ip);
  const rateMs = Math.round(performance.now() - tRate0);
  if (!rate.allowed) {
    return jsonResponse(
      req,
      429,
      { error: "Too many requests. Please slow down." },
      { "Retry-After": String(rate.retryAfterSeconds ?? 60) },
    );
  }
  const tBudget0 = performance.now();
  const budget = await checkDailyBudget();
  const budgetMs = Math.round(performance.now() - tBudget0);
  if (!budget.allowed) {
    return jsonResponse(
      req,
      429,
      { error: "The assistant has reached its daily limit. Try again later." },
      { "Retry-After": String(budget.retryAfterSeconds ?? 3600) },
    );
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();

  const question = messages[messages.length - 1]!.content;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      let capturedSources: ChatSource[] = [];
      let ok = false;
      let tokens = 0;
      let firstTokenAt = 0;

      try {
        const result = await runChatTurn(
          messages,
          {
            onToken: (text) => {
              if (!firstTokenAt) firstTokenAt = performance.now();
              send("token", { text });
            },
            onSources: (sources) => {
              capturedSources = sources;
              send("sources", { sources });
            },
          },
          { signal: abort.signal },
        );
        tokens = result.approxTokens;
        await recordTokenUsage(tokens);
        ok = true;
        const timings = {
          // Pre-stream blocking work (Upstash round-trips).
          rateMs,
          budgetMs,
          // Time from request start to the first streamed token.
          ttftMs: firstTokenAt
            ? Math.round(firstTokenAt - reqStart)
            : null,
          // Whole handler wall time.
          totalMs: Math.round(performance.now() - reqStart),
          // Per-round model time + per-tool execution time.
          agent: result.timings,
        };
        console.log("[fides-timing] chat", JSON.stringify(timings));
        send("done", { timings });
      } catch (e) {
        send("error", {
          message:
            e instanceof Error ? e.message : "The assistant failed to respond.",
        });
      } finally {
        // Best-effort usage logging (question + lightweight metadata, no IP,
        // no answer text). Never blocks or breaks the response.
        void logChatEvent({ question, ok, tokens, sources: capturedSources });
        // Privacy-friendly counter in Matomo (no question text, no IP).
        trackEvent({
          category: "Assistant",
          action: "question",
          name: ok ? "ok" : "error",
          value: tokens,
          url: "https://api.fides.community/api/chat",
          client: "website",
        });
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders(req),
    },
  });
}
