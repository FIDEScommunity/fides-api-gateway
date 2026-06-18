/**
 * Privacy-friendly, server-side usage analytics via the Matomo HTTP Tracking API.
 *
 * Records aggregate USAGE events for the public surfaces that browser-based
 * Matomo JavaScript can never see (server-to-server API/MCP traffic):
 *   - MCP connector (initialize / tools_list / tools_call + tool name + client),
 *   - public catalog API calls (per catalog + list/detail),
 *   - the website assistant (a bare counter; the question text stays in Redis).
 *
 * Deliberately privacy-preserving and aligned with the privacy policy (§3b/§5):
 *   - cookieless (no client cookies are ever set; this is pure server-side),
 *   - no IP override and no User-Agent override are sent, so NO `token_auth` is
 *     needed and nothing is attributed to an individual,
 *   - no free-text queries or answer text are sent — only counts, the tool/
 *     catalog, and a coarse client label (chatgpt/claude/…).
 *
 * Fire-and-forget: tracking must never delay or break a response. On Vercel we
 * hand the request to `waitUntil` so it completes after the response is sent;
 * off-Vercel it simply runs detached.
 *
 * Config (all optional; tracking is a no-op unless URL + site id are present):
 *   MATOMO_URL       e.g. https://fidescommunity.matomo.cloud
 *   MATOMO_SITE_ID   e.g. 1
 *   MATOMO_ENABLED   set to "0" to disable entirely
 *   MATOMO_CLIENT_DIMENSION_ID  optional Custom Dimension id for the client label
 */

import { waitUntil } from "@vercel/functions";

interface MatomoConfig {
  url: string;
  siteId: string;
}

function config(): MatomoConfig | null {
  if (process.env.MATOMO_ENABLED === "0") return null;
  const base = process.env.MATOMO_URL;
  const siteId = process.env.MATOMO_SITE_ID;
  if (!base || !/^https?:\/\//i.test(base) || !siteId) return null;
  return { url: base.replace(/\/+$/, ""), siteId: String(siteId) };
}

export interface MatomoEvent {
  /** Event category (e_c), e.g. "MCP", "API", "Assistant". */
  category: string;
  /** Event action (e_a), e.g. "tools_call", "wallet", "question". */
  action: string;
  /** Optional event name (e_n), e.g. the tool name or "list"/"detail". */
  name?: string;
  /** Optional numeric value (e_v). */
  value?: number;
  /** Synthetic action URL for context (no query string, no ids). */
  url?: string;
  /** Coarse client label to attach as a Custom Dimension when configured. */
  client?: string;
}

/** Schedule a best-effort tracking request; never throws. */
export function trackEvent(ev: MatomoEvent): void {
  const cfg = config();
  if (!cfg) return;

  const params = new URLSearchParams({
    idsite: cfg.siteId,
    rec: "1",
    apiv: "1",
    ca: "1", // mark as a custom action / event
    e_c: ev.category,
    e_a: ev.action,
    rand: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    send_image: "0",
  });
  if (ev.name) params.set("e_n", ev.name);
  if (typeof ev.value === "number" && Number.isFinite(ev.value)) {
    params.set("e_v", String(ev.value));
  }
  // Matomo expects a URL for every tracking request; use a synthetic, id-free
  // action URL so reports have context without leaking parameters.
  params.set("url", ev.url || "https://api.fides.community/");

  const dimId = process.env.MATOMO_CLIENT_DIMENSION_ID;
  if (ev.client && dimId && /^\d+$/.test(dimId)) {
    params.set(`dimension${dimId}`, ev.client);
  }

  const endpoint = `${cfg.url}/matomo.php?${params.toString()}`;

  const task = fetch(endpoint, { method: "GET", keepalive: true })
    .then(() => undefined)
    .catch(() => undefined);

  try {
    waitUntil(task);
  } catch {
    // Not in a Vercel request context (e.g. local/tests): let it run detached.
    void task;
  }
}

/**
 * Map a connector's clientInfo.name and/or User-Agent to a coarse, stable label
 * (chatgpt / claude / copilot / gemini / grok / cursor / …). Never includes
 * version strings or anything identifying — purely for splitting usage by AI app.
 */
export function classifyClient(
  userAgent?: string | null,
  clientInfoName?: string | null,
): string {
  const hay = `${clientInfoName ?? ""} ${userAgent ?? ""}`.toLowerCase();
  if (!hay.trim()) return "unknown";
  if (hay.includes("chatgpt") || hay.includes("openai")) return "chatgpt";
  if (hay.includes("claude") || hay.includes("anthropic")) return "claude";
  if (hay.includes("copilot")) return "copilot";
  if (hay.includes("gemini") || hay.includes("google")) return "gemini";
  if (hay.includes("grok") || hay.includes("xai")) return "grok";
  if (hay.includes("perplexity")) return "perplexity";
  if (hay.includes("cursor")) return "cursor";
  if (hay.includes("mcp-inspector") || hay.includes("inspector")) return "inspector";
  if (hay.includes("node") || hay.includes("curl") || hay.includes("python")) {
    return "script";
  }
  return "other";
}
