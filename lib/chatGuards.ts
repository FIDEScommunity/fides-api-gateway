/**
 * Origin allowlist + production readiness checks for the public /api/chat cost surface.
 *
 * Never reflects an unlisted Origin and never falls back to Access-Control-Allow-Origin: *.
 * When CHAT_ALLOWED_ORIGINS is unset, production defaults to https://fides.community only;
 * local/preview also allow localhost for vercel dev.
 */

import { upstashConfig } from "./upstash";

const DEFAULT_PROD_ORIGINS = [
  "https://fides.community",
  "https://www.fides.community",
];
const DEFAULT_DEV_ORIGINS = [
  "https://fides.community",
  "https://www.fides.community",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

export function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Comma-separated allowlist, or safe defaults (never "*"). */
export function chatAllowedOrigins(): string[] {
  const raw = (process.env.CHAT_ALLOWED_ORIGINS || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return isVercelProduction() ? DEFAULT_PROD_ORIGINS : DEFAULT_DEV_ORIGINS;
}

/**
 * Browser requests send Origin. Missing Origin (curl, server monitors) is allowed
 * but still rate-limited — CORS cannot protect those clients.
 */
export function isChatOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return true;
  return chatAllowedOrigins().includes(origin);
}

/**
 * CORS response headers. Only echo Origin when it is on the allowlist.
 * Disallowed / missing Origin → no Access-Control-Allow-Origin (fail closed for browsers).
 */
export function chatCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
  };
  if (origin && isChatOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/**
 * In production the chat endpoint requires a shared Redis store so rate limits
 * and daily budgets are global across Vercel instances.
 * Set CHAT_REQUIRE_UPSTASH=0 to temporarily override (not recommended).
 */
export function chatRateLimitStoreReady(): {
  ok: boolean;
  hint?: string;
} {
  const require =
    process.env.CHAT_REQUIRE_UPSTASH === "0"
      ? false
      : isVercelProduction() || process.env.CHAT_REQUIRE_UPSTASH === "1";
  if (!require) return { ok: true };
  if (upstashConfig()) return { ok: true };
  return {
    ok: false,
    hint:
      "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*). " +
      "Chat refuses to run without a shared rate-limit store in production.",
  };
}
