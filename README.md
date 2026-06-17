# FIDES API Gateway

Single **Vercel** deployment that proxies public catalog APIs to each catalog’s own project (typically `*.vercel.app`). Use this when you want one hostname (for example `https://api.fides.community`) for credential, organization, issuer, wallet, and future catalogs.

## Prerequisites

Each catalog must already be deployed to Vercel with working routes, for example:

- Credential: `GET /api/public/credentialtype`, `GET /api/public/credentialtype/{id}`, `GET /api/public/api-docs` (upstream path; on the gateway use `credential-api-docs` — see Step 3).
- Organization: `GET /api/public/organization`, `GET /api/public/organization/{id}`, `GET /api/public/api-docs` (upstream; on the gateway use `organization-api-docs`).
- Issuer: `GET /api/public/issuer`, `GET /api/public/issuer/{id}`, `GET /api/public/api-docs` (upstream; on the gateway use `issuer-api-docs`).
- Wallet: `GET /api/public/wallet`, wallet detail path, and `GET /api/public/api-docs` (upstream; on the gateway use `wallet-api-docs` for the OpenAPI spec).

Use each project’s **production `https://<name>.vercel.app` URL** as upstream — **not** the gateway hostname — or you will create a proxy loop.

### Gateway URL scheme (symmetry)

| Catalog | List | Detail | OpenAPI JSON | Swagger UI |
|---------|------|--------|--------------|--------------|
| Credential | `/api/public/credentialtype` | `/api/public/credentialtype/{id}` | `/api/public/credential-api-docs` | `/swagger-credentialtype.html` |
| Organization | `/api/public/organization` | `/api/public/organization/{id}` | `/api/public/organization-api-docs` | `/swagger-organization.html` |
| Issuer | `/api/public/issuer` | `/api/public/issuer/{id}` | `/api/public/issuer-api-docs` | `/swagger-issuer.html` |
| Wallet | `/api/public/wallet` | `/api/public/wallet/{orgId}/{walletId}` | `/api/public/wallet-api-docs` | `/swagger-wallet.html` |

Legacy **308 redirects**: `/api/public/api-docs` and `/swagger.html` → credential equivalents (old links keep working).

### Issuer list query filters (via gateway)

The gateway forwards issuer query parameters unchanged to the issuer upstream.
Current issuer list filters include:

- `search`
- `environment`
- `orgId`
- `vcFormat`
- `credentialCatalogId`
- `subjectType`
- `tags`
- `country`
- `sort`, `direction`, `page`, `size`

### Agent discovery — `/.well-known/api-catalog` (RFC 9727)

This gateway exposes [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) **api-catalog** discovery:

- **URL:** `GET` / `HEAD` `https://<gateway>/.well-known/api-catalog`
- **Format:** `application/linkset+json` with profile `https://www.rfc-editor.org/info/rfc9727`
- **Implementation:** `api/well-known-api-catalog.ts`, rewritten in `vercel.json` from `/.well-known/api-catalog`

`HEAD` responses include a `Link` header with `rel="api-catalog"` as required by the RFC.

### Maintaining discovery (`lib/gatewayCatalogs.ts`)

**`lib/gatewayCatalogs.ts` is the single place to update** when you add, remove, or rename gateway routes for a catalog (list path, OpenAPI path, Swagger HTML, upstream env var name). It feeds:

| Consumer | Purpose |
|----------|---------|
| `api/public/catalogs.ts` | JSON list of catalogs and paths (`configured` follows upstream env vars) |
| `api/well-known-api-catalog.ts` | RFC 9727 Linkset: `item` links to each **configured** catalog’s list endpoint |

If you add a new proxy under `api/public/` but forget to extend `GATEWAY_CATALOG_ROUTES`, automated discovery and agent-oriented tools will be **out of date** even if the route works.

**Checklist when changing the public API surface**

1. Edit **`lib/gatewayCatalogs.ts`** (`GATEWAY_CATALOG_ROUTES`, and `GatewayCatalogId` if you add a catalog).
2. Add or adjust **serverless handlers** and **`vercel.json`** redirects if paths change.
3. Redeploy and verify **`/api/public/catalogs`** and **`/.well-known/api-catalog`** (with `Accept: application/linkset+json`).

---

## MCP server — AI connector (proof of concept)

The gateway also exposes an **MCP** (Model Context Protocol) server so the FIDES
Ecosystem Explorer can be added as an "app"/connector in ChatGPT, Claude, and
other MCP clients. It covers **all configured catalogs**; see
`docs/MCP-IMPLEMENTATION-PLAN.md` for the design.

- **Endpoint (Streamable HTTP):** `POST https://<gateway>/api/mcp`
- **Implementation:** `api/mcp.ts` (via `mcp-handler`); tool layer in `lib/`
  (`catalogClient.ts` + `*Tools.ts`, aggregated by `catalogTools.ts`).
- **Catalog tools:** `search_wallets`/`get_wallet`,
  `search_credential_types`/`get_credential_type`,
  `search_organizations`/`get_organization`, `search_issuers`/`get_issuer`.
- **Generic tools:** `search` (federated across all catalogs) and `fetch`
  (retrieve a record by result id) — the shapes ChatGPT uses for connectors /
  Deep Research, returning canonical URLs for citations.
- **Requires:** the relevant `FIDES_*_CATALOG_ORIGIN` set per catalog; optional
  `GATEWAY_PUBLIC_ORIGIN` (defaults to `https://api.fides.community`) for
  canonical links in tool output. A catalog whose origin env is unset is simply
  skipped by the generic `search`.
- Runs **stateless** (no Redis); read-only and unauthenticated like the rest of
  the gateway.

### Add as a connector

- **Claude** (claude.ai / Desktop): Settings → Connectors → **Add custom
  connector** → URL `https://<gateway>/api/mcp`.
- **ChatGPT**: Settings → Apps & Connectors → Advanced → enable **Developer
  Mode** → **Create** → URL `https://<gateway>/api/mcp`.
- **Any MCP client** (Cursor, MCP Inspector, API Playground): point it at the
  same `/api/mcp` URL.

### Verify

```bash
npm run typecheck
npx @modelcontextprotocol/inspector   # connect to https://<gateway>/api/mcp, list tools
```

> Note: the dependency-only `npm audit` warnings come from `@vercel/node`
> transitive packages (tar/undici), not from the MCP packages.

---

## Conversational interface — homepage assistant (Phase 2)

The gateway also hosts the backend for a **chat assistant** on the FIDES
homepage. It reuses the *same* catalog tool layer as the MCP server (no
duplication): `lib/toolRegistry.ts` replays the shared tool registration into an
in-memory registry, exposes a JSON-Schema view for LLM function calling, and the
agent calls those handlers directly — no MCP transport internally.

- **Endpoint:** `POST https://<gateway>/api/chat`, body
  `{ "messages": [{ "role": "user", "content": "..." }] }`.
- **Response:** `text/event-stream` (SSE) with `token`, `sources`, `done`, and
  `error` events. `sources` carries citable `{ title, url, type }` detail pages.
- **Implementation:** `api/chat.ts` (Fetch-style, like `api/mcp.ts`) →
  `lib/chatAgent.ts` (tool-calling loop) → `lib/llm.ts` (provider adapter) +
  `lib/rateLimit.ts`.
- **LLM provider:** OpenAI-compatible `/chat/completions` adapter. Default is
  **Mistral** (EU/GDPR-conscious); `openai` and `azure` work via env only. The
  provider key (`LLM_API_KEY`) is **server-side only** — never in WordPress or
  the browser.
- **Grounding:** the system prompt forbids answering without tool data and
  requires linking to canonical `api.fides.community` detail URLs; answers follow
  the language of the question (NL/EN).
- **Site-content search (`lib/siteTools.ts`):** an optional `search_site_content`
  tool answers conceptual/general questions ("what is a business wallet", what
  FIDES is, manifesto, use cases, news) from the public FIDES website over the
  WordPress REST API (`/wp-json/wp/v2/pages|posts`), returning short citable page
  excerpts. **Kill switch:** enabled by default; set `CHAT_SITE_CONTENT_ENABLED=0`
  to remove the tool entirely (chat falls back to catalog-only answers). Site
  origin is `FIDES_SITE_ORIGIN` (default `https://fides.community`).
- **Cost controls (public endpoint):** per-IP rate limit
  (`CHAT_RATE_LIMIT_PER_MIN`) + daily approximate-token budget
  (`CHAT_DAILY_TOKEN_BUDGET`). Uses Upstash Redis (REST) when configured,
  otherwise per-instance in-memory counters. `CHAT_ALLOWED_ORIGINS` restricts the
  browser origins permitted to call the endpoint.
- **Usage logging (`lib/chatLog.ts`):** when Upstash is configured, each turn is
  logged anonymously to a per-day list `chat:log:YYYY-MM-DD` — the question text
  plus lightweight metadata (`ok`, approx `tokens`, source count + counts per
  catalog type). **No IP, no session id, and no answer text are stored.** The
  list auto-expires (`CHAT_LOG_RETENTION_DAYS`, default 90) and is capped per day
  (`CHAT_LOG_MAX_PER_DAY`, default 5000). Disable with `CHAT_LOG_ENABLED=0`. This
  is for understanding what visitors ask so the catalogs/site can be improved.

See `.env.example` for all chat env vars and `docs/MCP-IMPLEMENTATION-PLAN.md`
→ section 4 for the design. The WordPress chat widget lives in the
`fides-assistant` plugin.

---

## Step 1 — Organization catalog on Vercel

1. In [Vercel](https://vercel.com): **Add New… → Project** and import the **fides-organization-catalog** GitHub repository.
2. **Root directory:** repository root (must contain `vercel.json`, `package.json`, `api/`, `public/`).
3. Leave **Build / Output** to the values from `vercel.json` (`npm ci`, `outputDirectory: public`, no framework).
4. Deploy and open the **Production** URL, for example `https://fides-organization-catalog.vercel.app`.
5. Verify:
   - `GET …/api/public/organization?page=0&size=5`
   - `GET …/api/public/api-docs` (OpenAPI on the organization project itself)
   - Optional: `…/swagger.html` (on the organization project)

Copy this production base URL (no trailing slash) for Step 3.

---

## Step 2 — Credential catalog upstream URL

If the credential catalog is already on Vercel, copy its **production `*.vercel.app`** base URL the same way.

If `api.fides.community` is currently assigned to the credential project, that domain is **not** the value you put in env vars here — use the underlying **`.vercel.app`** URL from the Vercel dashboard (Project → Domains / deployment URL).

---

## Step 3 — Deploy this gateway

1. Create a **new** Vercel project from this repository (`fides-api-gateway`).
2. In **Settings → Environment Variables** (Production), set:

   | Name | Example value |
   |------|----------------|
   | `FIDES_CREDENTIAL_CATALOG_ORIGIN` | `https://fides-credential-catalog.vercel.app` |
   | `FIDES_ORGANIZATION_CATALOG_ORIGIN` | `https://fides-organization-catalog.vercel.app` |
   | `FIDES_ISSUER_CATALOG_ORIGIN` | `https://fides-issuer-catalog.vercel.app` |
   | `FIDES_WALLET_CATALOG_ORIGIN` | `https://fides-wallet-catalog.vercel.app` |

   See `.env.example` for the full list. Omit an origin if you do not want that catalog on this gateway yet.

3. Redeploy after saving variables.
4. Test the gateway production URL:
   - `/api/public/catalogs`
   - `/.well-known/api-catalog` (RFC 9727 Linkset; use `Accept: application/linkset+json` if your client negotiates)
   - `/api/public/credentialtype`
   - `/api/public/credential-api-docs`
   - `/api/public/organization`
   - `/api/public/issuer` and `/api/public/issuer-api-docs` (when `FIDES_ISSUER_CATALOG_ORIGIN` is set)
   - `/swagger-credentialtype.html`, `/swagger-organization.html`, `/swagger-issuer.html`, `/swagger-wallet.html`
   - When `FIDES_WALLET_CATALOG_ORIGIN` is set: `/api/public/wallet` and wallet detail URLs
   - Legacy (308 redirect): `/api/public/api-docs` → credential spec; `/swagger.html` → credential Swagger

---

## Step 4 — Custom domain (`api.fides.community`)

Use this when the gateway is already **verified** on its `*.vercel.app` URL (Step 3) and upstream env vars use those **`*.vercel.app`** bases — never the public API hostname (avoids a proxy loop).

### 4a — Double-check before you touch DNS

- [ ] `https://<gateway>.vercel.app/api/public/catalogs` shows each catalog you need as `configured: true`.
- [ ] `https://<gateway>.vercel.app/api/public/credentialtype` returns data (proxies to credential backend).
- [ ] `FIDES_CREDENTIAL_CATALOG_ORIGIN` in the gateway project is the credential project’s **`.vercel.app`** URL, **not** `https://api.fides.community`.

### 4b — Move the domain in Vercel (order matters)

A hostname can only be attached to **one** Vercel project at a time.

1. **Credential catalog project** (where `api.fides.community` is today): **Settings → Domains** → find `api.fides.community` → **Remove** (or “Edit” → remove).  
   - The credential API stays available at its **`*.vercel.app`** URL for the gateway upstream.

2. **Gateway project**: **Settings → Domains** → **Add** → enter `api.fides.community` → confirm.

3. If Vercel shows **DNS instructions** (CNAME / A record): apply them at your DNS host (often the same records you used for the credential project; Vercel will show the current expected values). Wait until the domain shows **Valid** on the gateway project.

4. **Redeploy** the gateway if Vercel suggests it after the domain change (usually not strictly required, but safe).

### 4c — After cutover

- Public URLs become: `https://api.fides.community/api/public/credentialtype`, `/api/public/organization`, `/api/public/issuer`, `/api/public/wallet`, etc.
- **Do not** change upstream env vars to `https://api.fides.community` — keep **`*.vercel.app`** origins.

### Rollback

If something goes wrong: remove the domain from the **gateway** project, add it back to the **credential** project, fix DNS if needed, then debug the gateway on `*.vercel.app` again before retrying.

---

## Local development

```bash
npm ci
npm run typecheck
```

Use [Vercel CLI](https://vercel.com/docs/cli) `vercel dev` with a local `.env` mirroring `.env.example` to exercise proxies locally.

---

## Adding RP later

**Issuer** and **wallet** use the same pattern (`FIDES_*_CATALOG_ORIGIN`, dedicated `*-api-docs` and Swagger HTML) once each catalog is deployed to Vercel.

For the **RP** catalog:

1. Add the serverless API pattern in that repo (see `credential-catalog/API_SETUP.md`).
2. Deploy to Vercel; note its `*.vercel.app` origin.
3. In this gateway: new env var, proxy handlers, extend **`lib/gatewayCatalogs.ts`** (and `GatewayCatalogId`), update **`public/index.html`** if you list catalogs there, then verify **`/api/public/catalogs`** and **`/.well-known/api-catalog`**.
