/**
 * Lightweight unit checks for chat origin / Upstash readiness guards.
 * Run: node --experimental-strip-types --test lib/chatGuards.test.ts
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  chatAllowedOrigins,
  chatRateLimitStoreReady,
  isChatOriginAllowed,
} from "./chatGuards";

const keys = [
  "VERCEL_ENV",
  "CHAT_ALLOWED_ORIGINS",
  "CHAT_REQUIRE_UPSTASH",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

const saved: Record<string, string | undefined> = {};

function snapshotEnv(): void {
  for (const k of keys) saved[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function clearGuardedEnv(): void {
  for (const k of keys) delete process.env[k];
}

snapshotEnv();
afterEach(() => {
  restoreEnv();
  snapshotEnv();
});

describe("chatAllowedOrigins", () => {
  it("never returns star and defaults production to fides.community", () => {
    clearGuardedEnv();
    process.env.VERCEL_ENV = "production";
    const origins = chatAllowedOrigins();
    assert.deepEqual(origins, [
      "https://fides.community",
      "https://www.fides.community",
    ]);
    assert.ok(!origins.includes("*"));
  });

  it("honours CHAT_ALLOWED_ORIGINS when set", () => {
    clearGuardedEnv();
    process.env.CHAT_ALLOWED_ORIGINS =
      "https://fides.community, https://staging.example";
    assert.deepEqual(chatAllowedOrigins(), [
      "https://fides.community",
      "https://staging.example",
    ]);
  });
});

describe("isChatOriginAllowed", () => {
  it("allows missing Origin (non-browser) and blocks evil browser Origin", () => {
    clearGuardedEnv();
    process.env.VERCEL_ENV = "production";
    assert.equal(isChatOriginAllowed(null), true);
    assert.equal(isChatOriginAllowed("https://fides.community"), true);
    assert.equal(isChatOriginAllowed("https://evil.example"), false);
  });
});

describe("chatRateLimitStoreReady", () => {
  it("fails closed in production without Upstash", () => {
    clearGuardedEnv();
    process.env.VERCEL_ENV = "production";
    const ready = chatRateLimitStoreReady();
    assert.equal(ready.ok, false);
    assert.match(ready.hint || "", /UPSTASH/);
  });

  it("passes in production when Upstash is configured", () => {
    clearGuardedEnv();
    process.env.VERCEL_ENV = "production";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    assert.equal(chatRateLimitStoreReady().ok, true);
  });

  it("allows local/preview without Upstash", () => {
    clearGuardedEnv();
    process.env.VERCEL_ENV = "preview";
    assert.equal(chatRateLimitStoreReady().ok, true);
  });
});
