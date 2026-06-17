/**
 * Minimal Upstash Redis REST client shared by the chat rate limiter
 * (lib/rateLimit.ts) and the chat usage logger (lib/chatLog.ts).
 *
 * Only used when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set.
 */

export interface UpstashConfig {
  url: string;
  token: string;
}

/** First non-empty env var whose name passes `match`. */
function pickEnv(match: (name: string) => boolean): string | undefined {
  for (const [name, value] of Object.entries(process.env)) {
    if (value && match(name)) return value;
  }
  return undefined;
}

/**
 * Resolve the Upstash REST URL + token from the environment, or null when unset.
 *
 * Accepts several naming schemes so it works regardless of how the Vercel
 * Marketplace integration named the variables (a "Custom Prefix" is prepended to
 * the standard KV names, e.g. `UPSTASH_REDIS_REST_KV_REST_API_URL`):
 *   1. Canonical: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   2. Vercel KV: KV_REST_API_URL / KV_REST_API_TOKEN
 *   3. Any prefixed variant ending in those names (read-only token excluded).
 */
export function upstashConfig(): UpstashConfig | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    pickEnv((n) => n.endsWith("KV_REST_API_URL")) ||
    pickEnv((n) => n.endsWith("UPSTASH_REDIS_REST_URL"));

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    pickEnv((n) => n.endsWith("KV_REST_API_TOKEN") && !n.includes("READ_ONLY")) ||
    pickEnv((n) => n.endsWith("UPSTASH_REDIS_REST_TOKEN"));

  if (url && token && /^https?:\/\//i.test(url)) {
    return { url: url.replace(/\/+$/, ""), token };
  }
  return null;
}

/** Run a single Redis command via the Upstash REST API; returns the result. */
export async function upstashCmd(
  cfg: UpstashConfig,
  command: (string | number)[],
): Promise<unknown> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}
