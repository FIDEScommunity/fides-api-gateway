# FIDES Ecosystem Explorer — MCP Implementation Plan

Goal: expose the **FIDES Ecosystem Explorer** (the combined credential /
organization / issuer / wallet catalogs) as a remote **MCP server** so it can be
added as an "app" / connector to ChatGPT, Claude, and other MCP clients — and,
in a second phase, power a **conversational interface on the FIDES homepage**.

> TL;DR — Does this go via the API? **Yes.** The MCP server lives on the existing
> `fides-api-gateway` (Vercel), reuses the existing upstream proxies, and is
> served at `https://api.fides.community/mcp`. One tool layer, two consumers:
> external LLM clients (Phase 1) and the website chat widget (Phase 2).

---

## 1. Why the gateway is the right home

The gateway already is:

- a **single hostname** (`api.fides.community`) in front of all catalog backends;
- **read-only** (`GET`/`OPTIONS` only) — matches MCP "safe tool" semantics;
- **agent-discovery oriented** — RFC 9727 `/.well-known/api-catalog`,
  `/api/public/catalogs`, and per-catalog OpenAPI specs;
- driven by a **single source of truth**, `lib/gatewayCatalogs.ts`
  (`GATEWAY_CATALOG_ROUTES`).

So the MCP tools are essentially a thin, typed wrapper around routes we already
expose. Nothing new needs to be deployed elsewhere.

### Architecture (target)

```
                         ┌─────────────────────────────────────────┐
                         │            fides-api-gateway              │
                         │              (Vercel, TS)                 │
 ChatGPT / Claude  ──────┤  POST /mcp  ── api/mcp.ts                 │
 (remote MCP client)     │                │                         │
                         │                ▼                         │
 FIDES homepage    ──────┤  POST /api/chat ── api/chat.ts           │
 (chat widget)           │                │   (LLM + tool calling)  │
                         │                ▼                         │
                         │   lib/catalogTools.ts  ◄── single tool   │
                         │                │            layer        │
                         │                ▼                         │
                         │   lib/proxyUpstream.ts  ── fetch ──►  per-catalog
                         │   GATEWAY_CATALOG_ROUTES               *.vercel.app
                         └─────────────────────────────────────────┘
```

Key principle: **both** the MCP endpoint and the website chat endpoint call the
*same* `lib/catalogTools.ts`. We never duplicate catalog logic.

---

## 2. Phase 1 — MCP server on the gateway

### 2.1 Dependencies

The gateway currently has **zero runtime dependencies**. MCP adds the first ones:

```bash
npm install mcp-handler@^1.1.0 @modelcontextprotocol/sdk@^1.26.0 zod@^3
```

> Security note: pin `mcp-handler >= 1.1.0` and `@modelcontextprotocol/sdk >= 1.26.0`.
> Earlier versions are affected by **CVE-2026-25536** (tool-response leak across
> concurrent stateless sessions). `mcp-handler@1.1.0` enforces the fixed SDK range.

### 2.2 New / changed files

| File | Purpose |
|------|---------|
| `lib/catalogTools.ts` | **New.** Shared tool definitions + handlers (the tool layer). Reused by MCP and chat. |
| `lib/catalogClient.ts` | **New (optional).** Small typed helpers to call upstream catalogs server-side (wraps `fetch` to the `*_ORIGIN` env vars, mirroring `proxyUpstream`). |
| `api/mcp.ts` | **New.** The MCP Streamable HTTP endpoint via `mcp-handler`. |
| `vercel.json` | **Change.** Rewrite `/mcp` → `/api/mcp`; raise `maxDuration` for the MCP function. |
| `lib/gatewayCatalogs.ts` | **Change.** Add an `mcpPath` field (`/mcp`) so discovery advertises it. |
| `api/public/catalogs.ts` | **Change.** Surface the MCP endpoint in the discovery JSON. |
| `api/well-known-api-catalog.ts` | **Change.** Add the MCP endpoint as a service link in the linkset. |
| `public/index.html` | **Change.** Add an "AI / MCP" card describing the connector URL. |
| `.env.example` / README | **Change.** Document new env vars + connector setup. |

### 2.3 Runtime-style consideration (important)

`mcp-handler` exposes a **Fetch-style** handler (`(req: Request) => Response`),
the same shape Next.js route handlers use. The existing gateway functions are
**Node-style** `@vercel/node` handlers (`(req: VercelRequest, res: VercelResponse)`).
Vercel supports both styles, but per-file. Two options:

- **Recommended:** implement `api/mcp.ts` as a Fetch-style function (export
  `GET`/`POST`/`DELETE` or a default that takes a `Request`). This is the path
  `mcp-handler` is designed for and keeps the code minimal.
- **Fallback:** use `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`
  directly against Node `req/res`. More code, and you **must** create a fresh
  `McpServer` + transport per request (the CVE above). Only do this if the
  Fetch-style function causes routing friction.

Spike both for ~30 min during implementation; default to the recommended path.

### 2.4 Tool design

Two groups of tools.

**A. Catalog-specific tools (primary UX).** Generated from `GATEWAY_CATALOG_ROUTES`,
with typed `zod` input schemas mirroring the documented query filters:

| Tool | Wraps | Notes |
|------|-------|-------|
| `search_credential_types` | `GET /api/public/credentialtype` | search, paging |
| `get_credential_type` | `GET /api/public/credentialtype/{id}` | by id |
| `search_organizations` | `GET /api/public/organization` | `search`, `country`, `role`, `certification[]`, sort, paging |
| `get_organization` | `GET /api/public/organization/{id}` | by id (`org:animo` → URL-encode) |
| `search_issuers` | `GET /api/public/issuer` | `search`, `environment`, `orgId`, `vcFormat`, `credentialCatalogId`, `subjectType`, `tags`, `country`, sort, paging |
| `get_issuer` | `GET /api/public/issuer/{id}` | by id |
| `search_wallets` | `GET /api/public/wallet` | wallet filters |
| `get_wallet` | `GET /api/public/wallet/{orgId}/{walletId}` | by composite id |
| `list_catalogs` | `GET /api/public/catalogs` | ecosystem overview / discovery |

Each tool:
- validates input with `zod`;
- calls the upstream via the catalog client (server-side, using `*_ORIGIN` env);
- returns a **structured `content` block** plus the **canonical detail URL** on
  `api.fides.community` (so the LLM can cite/link to the real Explorer page).

**B. Generic `search` + `fetch` tools (compatibility layer).** ChatGPT's
connectors, "Company knowledge", and Deep Research bias toward — and in
non-developer contexts *require* — two tools with specific MCP schemas:

- `search(query)` → `{ results: [{ id, title, url }] }` (federated across all
  four catalogs).
- `fetch(id)` → full record JSON for that id, with a canonical `url`.

Implementing both makes the connector work without forcing Developer Mode and
makes us eligible as a citable knowledge source. Internally they fan out to the
catalog-specific handlers.

### 2.5 `api/mcp.ts` sketch (recommended Fetch-style)

```ts
import { createMcpHandler } from "mcp-handler";
import { registerCatalogTools } from "../lib/catalogTools";

const handler = createMcpHandler(
  (server) => {
    registerCatalogTools(server); // adds both groups A + B
  },
  {
    serverInfo: { name: "fides-ecosystem-explorer", version: "1.0.0" },
  },
  {
    basePath: "/", // /mcp is the public path (see vercel.json rewrite)
    maxDuration: 60,
    verboseLogs: false,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
```

`lib/catalogTools.ts` sketch:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GATEWAY_CATALOG_ROUTES } from "./gatewayCatalogs";
import { fetchUpstreamJson, detailUrl } from "./catalogClient";

export function registerCatalogTools(server: McpServer): void {
  server.tool(
    "search_issuers",
    "Search FIDES issuers by country, VC format, tags, etc.",
    {
      search: z.string().optional(),
      country: z.string().length(2).optional(),
      vcFormat: z.string().optional(),
      tags: z.string().optional(),
      page: z.number().int().min(0).default(0),
      size: z.number().int().min(1).max(50).default(20),
    },
    async (args) => {
      const data = await fetchUpstreamJson("issuer", "/api/public/issuer", args);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
  // ... other catalog tools, generated where possible from GATEWAY_CATALOG_ROUTES
  // ... plus generic search() + fetch()
}
```

### 2.6 `vercel.json` changes

```jsonc
{
  "rewrites": [
    { "source": "/.well-known/api-catalog", "destination": "/api/well-known-api-catalog" },
    { "source": "/mcp", "destination": "/api/mcp" }
  ],
  "functions": {
    "api/**/*.ts": { "memory": 256, "maxDuration": 10 },
    "api/mcp.ts": { "memory": 512, "maxDuration": 60 }
  }
}
```

MCP runs **stateless** (Vercel functions don't share memory between
invocations). This is the `mcp-handler` default and is correct for read-only
tools — no Redis needed.

### 2.7 Auth

Phase 1 is **public + read-only**, like the rest of the gateway → no auth, no
OAuth. Keep CORS as-is (`applyCors`). If we later expose write tools or want
per-client quotas, add OAuth 2.1 protected-resource metadata (RFC 9728), which
`mcp-handler` supports via `withMcpAuth`. Out of scope for v1.

Hardening to include in v1:
- **Origin allowlist** for browser-originated MCP traffic (SDK does not validate
  Origin by default).
- **Rate limiting** on `/mcp` (per-IP), since it is unauthenticated.
- Bound `size`/paging in tool schemas to prevent large fan-out.

---

## 3. Registering the Explorer as an "app" / connector

### 3.1 Claude (Claude.ai / Desktop)

1. Settings → **Connectors** → **Add custom connector**.
2. URL: `https://api.fides.community/mcp`.
3. No auth → connects immediately; tools appear in the picker.

(Claude.ai reaches the server from Anthropic's cloud, so the public HTTPS
gateway URL is exactly right — no tunnel needed in production.)

### 3.2 ChatGPT

- **Chat mode (tool use):** Settings → Apps & Connectors → Advanced →
  enable **Developer Mode** → **Create** connector → URL
  `https://api.fides.community/mcp`. Arbitrary read tools work here.
- **Connectors / Company knowledge / Deep Research (no Developer Mode):**
  requires the generic `search` + `fetch` tools (group B above) with the exact
  MCP schemas and canonical `url` fields for citations. We implement these, so
  the Explorer is usable as a citable knowledge source too.
- **Full "App" with custom UI** (Apps SDK, iframe component): optional later —
  would add an MCP UI resource (`text/html;profile=...mcp-app`) rendering, e.g.,
  a mini catalog-map or result cards inside ChatGPT. Not required for v1.

### 3.3 Other clients

Any Streamable-HTTP MCP client (Cursor, MCP Inspector, Claude Code, the OpenAI
API Playground) can point at `https://api.fides.community/mcp`. For legacy
stdio-only clients, document the `npx mcp-remote https://api.fides.community/mcp`
bridge.

---

## 4. Phase 2 — Conversational interface on the FIDES homepage

Reuse the **same tool layer**; only add an LLM orchestration endpoint and a UI.

### 4.1 Backend: `api/chat.ts` (gateway)

- New Node/Fetch function on the gateway.
- Holds the **LLM provider key** in a server-side env var (`LLM_API_KEY`) — never
  in WordPress/browser.
- Runs a tool-calling loop using the **same handlers** from `lib/catalogTools.ts`
  (no MCP transport needed internally — call the handlers directly).
- **Streams** tokens back (SSE / chunked) for a responsive UI. Note Vercel
  `maxDuration`: raise for `api/chat.ts` (e.g. 60s) like `api/mcp.ts`.
- System prompt constraints:
  - answer **only** from tool results; if no tool data, say so;
  - always link to the canonical `api.fides.community` / Explorer detail pages;
  - reply in the **language of the question** (NL/EN) — note: app UI strings stay
    English per repo rule, but generated answers follow the user.
- **Rate limiting + daily budget cap** (public endpoint = open cost surface).
- Optional response cache for common queries.

New env vars (add to `.env.example`):

```
LLM_PROVIDER=...           # e.g. openai|anthropic|azure (EU/GDPR-conscious choice)
LLM_API_KEY=...            # server-side only
LLM_MODEL=...              # model id
CHAT_RATE_LIMIT_PER_MIN=20 # per-IP guard
CHAT_DAILY_TOKEN_BUDGET=...# cost cap
```

### 4.2 Frontend: WordPress chat widget

Two options (pick during implementation):

- **A — new small plugin `fides-assistant`** (preferred): a shortcode/block
  `[fides_assistant]` that renders a chat widget calling `api.fides.community/api/chat`.
  Matches the existing per-feature plugin pattern (tiles/map/catalogs) and the
  shared `lib/fides-catalog-ui` styling. Mount it on the homepage.
- **B — extend `fides-community-tools-tiles`** with an assistant shortcode if we
  prefer to keep AI surfaces in the shared core plugin.

The widget is a thin client: it streams from `/api/chat`, renders markdown +
result cards, and deep-links into the catalogs/Explorer (and respects the modal
architecture contract — open details via shared `FidesCatalogUI`, not a new
modal lifecycle).

### 4.3 Privacy / GDPR

- Pick an EU/GDPR-appropriate LLM endpoint; disclose in a short notice that
  questions are sent to an AI provider.
- Do not log personal data unnecessarily; log only tool-call ids + latency.
- No training on user prompts (provider setting).

---

## 5. Concrete task checklist

**Phase 1 (MCP):**
1. [ ] Add deps: `mcp-handler@^1.1.0`, `@modelcontextprotocol/sdk@^1.26.0`, `zod@^3`.
2. [ ] `lib/catalogClient.ts` — server-side upstream fetch helpers (env-driven).
3. [ ] `lib/catalogTools.ts` — group A (per-catalog) + group B (`search`/`fetch`).
4. [ ] `api/mcp.ts` — `mcp-handler` Fetch-style endpoint (spike runtime style).
5. [ ] `vercel.json` — `/mcp` rewrite + per-function `maxDuration`.
6. [ ] Discovery: `mcpPath` in `lib/gatewayCatalogs.ts`, surface in
       `api/public/catalogs.ts` + `api/well-known-api-catalog.ts`.
7. [ ] `public/index.html` — "Add to ChatGPT / Claude" card with the `/mcp` URL.
8. [ ] Origin allowlist + rate limiting on `/mcp`.
9. [ ] `npm run typecheck` green; test with **MCP Inspector** against a Vercel
       preview; then add as a connector in Claude + ChatGPT.
10. [ ] README: connector setup section.

**Phase 2 (chat):**
11. [ ] `api/chat.ts` — streaming tool-calling loop reusing `catalogTools`.
12. [ ] Env vars + rate limit + budget cap.
13. [ ] `fides-assistant` WP plugin (shortcode/block) → homepage.
14. [ ] Sync plugin to utrecht-demo per the wp-plugin-sync rule; verify.

---

## 6. Verification

- `npm run typecheck` passes.
- MCP Inspector lists all tools and each returns valid structured content.
- Claude custom connector: connects, tools callable, answers link to real pages.
- ChatGPT Developer Mode connector: connects; `search`/`fetch` work for Deep Research.
- `/api/public/catalogs` and `/.well-known/api-catalog` advertise the MCP endpoint.
- Phase 2: homepage widget streams answers, respects rate limit, links into catalogs.

---

## 7. Risks & open decisions

| Topic | Decision needed |
|-------|-----------------|
| LLM provider | Which provider/model (EU/GDPR, cost, quality) for Phase 2. |
| Cost controls | Daily budget + per-IP limits for the public chat endpoint. |
| Runtime style | Fetch-style `api/mcp.ts` vs SDK-on-Node fallback (spike). |
| Auth | Stay public read-only for v1 (recommended) vs OAuth from the start. |
| ChatGPT "App" UI | Ship plain tools v1; add Apps SDK iframe component later? |
| Plugin home | New `fides-assistant` plugin vs extend tiles core. |

---

## 8. Effort estimate (rough)

- Phase 1 MCP server (tools A+B, discovery, hardening, connector test): **2–3 dev days**.
- Phase 2 chat endpoint + WP widget (streaming, limits, privacy): **3–5 dev days**.

Phase 1 delivers immediate value (Explorer as a connector in ChatGPT/Claude) and
de-risks Phase 2, since the tool layer is shared.
