/**
 * Lightweight security guards for the public MCP endpoint.
 *
 * Adds, around the `mcp-handler` Web Handler:
 * - Origin allowlist (mitigates DNS-rebinding / malicious browser-originated
 *   calls; the MCP SDK does not validate Origin by default). Server-to-server
 *   clients (ChatGPT/Claude cloud) send no Origin and are always allowed.
 * - Best-effort per-IP rate limiting. NOTE: Vercel functions are stateless and
 *   horizontally scaled, so this only throttles within a warm instance. For
 *   durable, global limits enable the Vercel Firewall (dashboard) or back this
 *   with Upstash Redis. It still blunts trivial single-instance floods.
 * - Hardening response headers (nosniff, restrictive CSP, no-referrer).
 *
 * Tunable via env:
 * - MCP_ALLOWED_ORIGINS  comma-separated host suffixes (default: known AI hosts)
 * - MCP_RATE_LIMIT_PER_MIN  integer requests/minute/IP (default 120; 0 disables)
 */

type WebHandler = (req: Request, ...rest: unknown[]) => Response | Promise<Response>;

const DEFAULT_ALLOWED_ORIGIN_SUFFIXES = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "oai.azure.com",
  "claude.ai",
  "anthropic.com",
  "cursor.com",
  "cursor.sh",
];

function allowedOriginSuffixes(): string[] {
  const env = process.env.MCP_ALLOWED_ORIGINS;
  if (env && env.trim()) {
    return env
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGIN_SUFFIXES;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function originAllowed(origin: string): boolean {
  const host = hostOf(origin);
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;

  const self = process.env.GATEWAY_PUBLIC_ORIGIN;
  if (self) {
    const selfHost = hostOf(self);
    if (selfHost && selfHost === host) return true;
  }

  return allowedOriginSuffixes().some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function rateLimitPerMin(): number {
  const raw = process.env.MCP_RATE_LIMIT_PER_MIN;
  if (raw == null || raw.trim() === "") return 120;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 120;
}

const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimitOk(ip: string, limit: number): boolean {
  if (limit === 0) return true;
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic cleanup so the map cannot grow unbounded on a warm instance.
  if (hits.size > 5000) {
    for (const key of Array.from(hits.keys())) {
      const keep = (hits.get(key) ?? []).filter((t: number) => now - t < WINDOW_MS);
      if (keep.length === 0) hits.delete(key);
      else hits.set(key, keep);
    }
  }
  return recent.length <= limit;
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function secure(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Access-Control-Allow-Origin")) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return secure(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
    }),
  );
}

/** Wrap an mcp-handler Web Handler with origin allowlist + rate limit.
 *
 * IMPORTANT: the success path returns the handler's Response **unmodified**.
 * The mcp-handler streamable-HTTP transport returns an SSE (`text/event-stream`)
 * body; re-wrapping it in a fresh `Response(res.body, …)` can disturb the
 * stream framing and trips strict clients (ChatGPT shows "Error in message
 * stream"). Hardening response headers for this route are applied at the edge
 * via `vercel.json`, so we do not need to touch the streamed response here.
 */
export function withMcpGuards(handler: WebHandler): WebHandler {
  return async (req: Request, ...rest: unknown[]): Promise<Response> => {
    const origin = req.headers.get("origin");
    if (origin && !originAllowed(origin)) {
      return jsonResponse({ error: "Origin not allowed", origin }, 403);
    }

    if (!rateLimitOk(clientIp(req), rateLimitPerMin())) {
      return jsonResponse(
        { error: "Rate limit exceeded. Try again shortly." },
        429,
        { "Retry-After": "60" },
      );
    }

    return handler(req, ...rest);
  };
}
