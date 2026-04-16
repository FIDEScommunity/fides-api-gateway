# FIDES API Gateway

Single **Vercel** deployment that proxies public catalog APIs to each catalog’s own project (typically `*.vercel.app`). Use this when you want one hostname (for example `https://api.fides.community`) for credential, organization, issuer, wallet, and future catalogs.

## Prerequisites

Each catalog must already be deployed to Vercel with working routes, for example:

- Credential: `GET /api/public/credentialtype`, `GET /api/public/api-docs` (upstream path; on the gateway use `credential-api-docs` — see Step 3).
- Organization: `GET /api/public/organization`, `GET /api/public/api-docs` (upstream; on the gateway use `organization-api-docs`).
- Issuer: `GET /api/public/issuer`, `GET /api/public/api-docs` (upstream; on the gateway use `issuer-api-docs`).
- Wallet: `GET /api/public/wallet`, plus `providers`, `stats`, `filter-options`, and `GET /api/public/api-docs` (upstream; on the gateway use `wallet-api-docs` for the OpenAPI spec).

Use each project’s **production `https://<name>.vercel.app` URL** as upstream — **not** the gateway hostname — or you will create a proxy loop.

### Gateway URL scheme (symmetry)

| Catalog | List | OpenAPI JSON | Swagger UI |
|---------|------|--------------|--------------|
| Credential | `/api/public/credentialtype` | `/api/public/credential-api-docs` | `/swagger-credentialtype.html` |
| Organization | `/api/public/organization` | `/api/public/organization-api-docs` | `/swagger-organization.html` |
| Issuer | `/api/public/issuer` | `/api/public/issuer-api-docs` | `/swagger-issuer.html` |
| Wallet | `/api/public/wallet` (+ `/api/public/providers`, `/stats`, `/filter-options`) | `/api/public/wallet-api-docs` | `/swagger-wallet.html` |

Legacy **308 redirects**: `/api/public/api-docs` and `/swagger.html` → credential equivalents (old links keep working).

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
   - `/api/public/credentialtype`
   - `/api/public/credential-api-docs`
   - `/api/public/organization`
   - `/api/public/issuer` and `/api/public/issuer-api-docs` (when `FIDES_ISSUER_CATALOG_ORIGIN` is set)
   - `/swagger-credentialtype.html`, `/swagger-organization.html`, `/swagger-issuer.html`, `/swagger-wallet.html`
   - When `FIDES_WALLET_CATALOG_ORIGIN` is set: `/api/public/wallet`, `/api/public/providers`, `/api/public/stats`, `/api/public/filter-options`
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
3. In this gateway: new env var, proxy handlers, and extend `/api/public/catalogs` + `public/index.html`.
