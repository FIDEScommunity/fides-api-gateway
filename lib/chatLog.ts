/**
 * Privacy-conscious usage logging for the public chat endpoint.
 *
 * Captures, per chat turn, the question text plus lightweight metadata so the
 * team can later see WHAT visitors use the assistant for and improve the site
 * accordingly. It deliberately does NOT store:
 *   - the assistant's answer text,
 *   - the visitor's IP address or any session identifier.
 *
 * Storage: Upstash Redis (same instance as the rate limiter). Each turn is
 * appended to a per-day list `chat:log:YYYY-MM-DD` (UTC) that auto-expires after
 * a retention window and is capped in length to bound storage. When Upstash is
 * not configured the logger is a no-op (per-instance memory would be useless).
 *
 * Toggle with CHAT_LOG_ENABLED=0. Tune with CHAT_LOG_RETENTION_DAYS (default 90)
 * and CHAT_LOG_MAX_PER_DAY (default 5000).
 */

import type { ChatSource } from "./chatAgent";
import { upstashCmd, upstashConfig } from "./upstash";

const MAX_QUESTION_CHARS = 500;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_PER_DAY = 5000;

export interface ChatLogInput {
  question: string;
  ok: boolean;
  tokens: number;
  sources: ChatSource[];
}

interface ChatLogEntry {
  ts: string;
  q: string;
  ok: boolean;
  tokens: number;
  sourceCount: number;
  sourceTypes: Record<string, number>;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Logging is on when Upstash is configured and not explicitly disabled. */
export function isChatLogEnabled(): boolean {
  return process.env.CHAT_LOG_ENABLED !== "0" && upstashConfig() !== null;
}

function buildEntry(input: ChatLogInput): ChatLogEntry {
  const sourceTypes: Record<string, number> = {};
  for (const s of input.sources) {
    const t = (s.type || "unknown").toLowerCase();
    sourceTypes[t] = (sourceTypes[t] || 0) + 1;
  }
  return {
    ts: new Date().toISOString(),
    q: input.question.slice(0, MAX_QUESTION_CHARS),
    ok: input.ok,
    tokens: Math.max(0, Math.ceil(input.tokens) || 0),
    sourceCount: input.sources.length,
    sourceTypes,
  };
}

/**
 * Record a chat turn. Never throws — logging must not affect the response.
 */
export async function logChatEvent(input: ChatLogInput): Promise<void> {
  const question = (input.question || "").trim();
  if (!question) return;
  const cfg = upstashConfig();
  if (!cfg || process.env.CHAT_LOG_ENABLED === "0") return;

  try {
    const key = `chat:log:${todayKey()}`;
    const entry = JSON.stringify(buildEntry({ ...input, question }));
    const len = (await upstashCmd(cfg, ["RPUSH", key, entry])) as number;
    if (len === 1) {
      const ttl = envInt("CHAT_LOG_RETENTION_DAYS", DEFAULT_RETENTION_DAYS) * 86400;
      await upstashCmd(cfg, ["EXPIRE", key, ttl]);
    }
    const max = envInt("CHAT_LOG_MAX_PER_DAY", DEFAULT_MAX_PER_DAY);
    if (typeof len === "number" && len > max) {
      // Keep only the most recent `max` entries for the day.
      await upstashCmd(cfg, ["LTRIM", key, -max, -1]);
    }
  } catch {
    // Swallow — logging is best-effort and must never break the chat.
  }
}
