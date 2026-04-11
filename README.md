# FIDES API Gateway

Single **Vercel** deployment that proxies public catalog APIs to each catalog’s own project (typically `*.vercel.app`). Use this when you want one hostname (for example `https://api.fides.community`) for credential + organization (+ future) APIs.

## Prerequisites

Each catalog must already be deployed to Vercel with working routes, for example:

- Credential: `GET /api/public/credentialtype`, `GET /api/public/api-docs`
- Organization: `GET /api/public/organization`, `GET /api/public/api-docs`

Use each project’s **production `https://<name>.vercel.app` URL** as upstream — **not** the gateway hostname — or you will create a proxy loop.

---

## Step 1 — Organization catalog on Vercel

1. In [Vercel](https://vercel.com): **Add New… → Project** and import the **fides-organization-catalog** GitHub repository.
2. **Root directory:** repository root (must contain `vercel.json`, `package.json`, `api/`, `public/`).
3. Leave **Build / Output** to the values from `vercel.json` (`npm ci`, `outputDirectory: public`, no framework).
4. Deploy and open the **Production** URL, for example `https://fides-organization-catalog.vercel.app`.
5. Verify:
   - `GET …/api/public/organization?page=0&size=5`
   - `GET …/api/public/api-docs`
   - Optional: `…/swagger.html`

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

   See `.env.example` for the full list.

3. Redeploy after saving variables.
4. Test the gateway production URL:
   - `/api/public/catalogs`
   - `/api/public/credentialtype`
   - `/api/public/organization`
   - `/swagger.html` and `/swagger-organization.html`

---

## Step 4 — Custom domain (optional)

When you are ready for a single public API host:

1. In the **gateway** Vercel project, add the domain (for example `api.fides.community`).
2. Remove that same domain from the **credential** project if it was attached there, so traffic hits the gateway only.
3. Keep upstream env vars pointed at **`*.vercel.app`** URLs.

---

## Local development

```bash
npm ci
npm run typecheck
```

Use [Vercel CLI](https://vercel.com/docs/cli) `vercel dev` with a local `.env` mirroring `.env.example` to exercise proxies locally.

---

## Adding wallet / RP / issuer later

1. Add the same serverless API pattern to those catalog repos (see `credential-catalog/API_SETUP.md`).
2. Deploy each to Vercel; note its `*.vercel.app` origin.
3. In this gateway: new env var, new `api/public/<route>.ts` handler using `proxySamePath` or `proxyWithPathRewrite`, and extend `/api/public/catalogs` + `public/index.html`.
