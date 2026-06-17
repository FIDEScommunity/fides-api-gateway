/**
 * Rate limiting + daily token-budget cap for the public chat endpoint.
 *
 * The chat endpoint is unauthenticated, so it is a cost surface that must be
 * bounded (see docs/MCP-IMPLEMENTATION-PLAN.md → 4.1, 7).
 *
 * Two layers:
 *  1. Per-IP request limit per minute (`CHAT_RATE_LIMIT_PER_MIN`).
 *  2. Global daily approximate-token budget (`CHAT_DAILY_TOKEN_BUDGET`).
 *
 * Storage: Upstash Redis REST when `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` are set (accurate across Vercel instances), with an
 * in-memory per-instance fallback otherwise so local/preview still work.
 */

import { upstashCmd, upstashConfig } from "./upstash";

const DEFAULT_RATE_PER_MIN = 20;

/* -------------------------------------------------------------------------
 * In-memory fallback (per serverless instance; best-effort only)
 * ----------------------------------------------------------------------- */

interface Counter {
  value: number;
  expiresAt: number;
}
const memory = new Map<string, Counter>();

function memIncr(key: string, ttlSeconds: number): number {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.expiresAt <= now) {
    memory.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  existing.value += 1;
  return existing.value;
}

function memIncrBy(key: string, amount: number, ttlSeconds: number): number {
  const now = Date.now();
  const existing = memory.get(key);
  if (!existing || existing.expiresAt <= now) {
    memory.set(key, { value: amount, expiresAt: now + ttlSeconds * 1000 });
    return amount;
  }
  existing.value += amount;
  return existing.value;
}

/* ------------------------------------------------------------------------- */

async function incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
  const cfg = upstashConfig();
  if (!cfg) return memIncr(key, ttlSeconds);
  try {
    const value = (await upstashCmd(cfg, ["INCR", key])) as number;
    if (value === 1) {
      await upstashCmd(cfg, ["EXPIRE", key, ttlSeconds]);
    }
    return value;
  } catch {
    // If the store is unreachable, fail open to in-memory so we still bound.
    return memIncr(key, ttlSeconds);
  }
}

async function incrByWithTtl(
  key: string,
  amount: number,
  ttlSeconds: number,
): Promise<number> {
  const cfg = upstashConfig();
  if (!cfg) return memIncrBy(key, amount, ttlSeconds);
  try {
    const value = (await upstashCmd(cfg, ["INCRBY", key, amount])) as number;
    if (value === amount) {
      await upstashCmd(cfg, ["EXPIRE", key, ttlSeconds]);
    }
    return value;
  } catch {
    return memIncrBy(key, amount, ttlSeconds);
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export interface RateDecision {
  allowed: boolean;
  reason?: "rate" | "budget";
  retryAfterSeconds?: number;
}

/** Per-IP request limit per minute. */
export async function checkRateLimit(ip: string): Promise<RateDecision> {
  const limit = Number(
    process.env.CHAT_RATE_LIMIT_PER_MIN || DEFAULT_RATE_PER_MIN,
  );
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true };
  const minute = Math.floor(Date.now() / 60000);
  const count = await incrWithTtl(`chat:rl:${ip}:${minute}`, 70);
  if (count > limit) {
    return { allowed: false, reason: "rate", retryAfterSeconds: 60 };
  }
  return { allowed: true };
}

/** Check the global daily token budget before starting a turn. */
export async function checkDailyBudget(): Promise<RateDecision> {
  const budget = Number(process.env.CHAT_DAILY_TOKEN_BUDGET || 0);
  if (!Number.isFinite(budget) || budget <= 0) return { allowed: true };
  const used = await incrByWithTtl(`chat:budget:${todayKey()}`, 0, 90000);
  if (used >= budget) {
    return { allowed: false, reason: "budget", retryAfterSeconds: 3600 };
  }
  return { allowed: true };
}

/** Record approximate token usage against the daily budget after a turn. */
export async function recordTokenUsage(tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await incrByWithTtl(
    `chat:budget:${todayKey()}`,
    Math.ceil(tokens),
    90000,
  );
}

/** Extract the client IP from a Fetch-style request. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
