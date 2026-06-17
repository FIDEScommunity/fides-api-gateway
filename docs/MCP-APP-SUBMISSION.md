# FIDES Ecosystem Explorer — MCP App Submission Metadata

Copy-paste source for submitting the FIDES MCP server as a public app/connector
(ChatGPT Apps directory and Claude connector directory). All user-facing text is
in English.

---

## Core facts

| Field | Value |
| --- | --- |
| **App / connector name** | FIDES Ecosystem Explorer |
| **Publisher / developer** | FIDES Labs BV |
| **MCP server URL** | `https://api.fides.community/api/mcp` |
| **Transport** | Streamable HTTP (stateless) |
| **Authentication** | None — public, read-only |
| **Privacy policy URL** | `https://fides.community/privacy` |
| **Terms of Service URL** | `https://fides.community/terms` |
| **Website / homepage** | `https://fides.community` |
| **Support / contact** | privacy@fides.community |
| **Category (primary)** | Productivity / Research & reference |
| **Category (secondary)** | Developer tools |

---

## Names & descriptions

**Short name (≤ 30 chars)**
```
FIDES Ecosystem Explorer
```

**Tagline / one-liner (≤ 80 chars)**
```
Search the European digital-identity ecosystem: wallets, issuers, credentials.
```

**Short description (≤ 160 chars)**
```
Query the FIDES catalogs of digital-identity wallets, issuers, relying parties, credential types and organizations — and the FIDES Community website.
```

**Long description**
```
FIDES Ecosystem Explorer gives AI assistants live, read-only access to the FIDES
catalogs — the open directory of the European digital-identity ecosystem (EUDI
and beyond).

Ask about:
• Wallets — personal and business digital-identity wallets and what they support.
• Issuers — who issues which credentials.
• Relying parties — verifier websites and services that request credentials.
• Credential types — credential/attestation definitions and their schemas.
• Organizations — the companies and bodies active in the ecosystem.
• FIDES Community content — pages, news and explanatory articles.

You can search within a specific catalog or run a federated search across all of
them, then fetch the full record for any result. All data is public and the
connector is strictly read-only — it never writes, edits or deletes anything.

Operated by FIDES Labs BV. No account or login required.
```

---

## Tools (13, all read-only)

| Tool | Purpose |
| --- | --- |
| `search` | Federated search across all FIDES catalogs |
| `fetch` | Fetch the full record for a single result id |
| `search_wallets` | Search the wallet catalog |
| `get_wallet` | Full details of one wallet |
| `search_issuers` | Search the issuer catalog |
| `get_issuer` | Full details of one issuer |
| `search_relying_parties` | Search the relying-party (verifier) catalog |
| `get_relying_party` | Full details of one relying party |
| `search_credential_types` | Search the credential-type catalog |
| `get_credential_type` | Full details of one credential type |
| `search_organizations` | Search the organization catalog |
| `get_organization` | Full details of one organization |
| `search_site_content` | Search the FIDES Community website |

All tools carry `readOnlyHint: true` and `openWorldHint: true` (they query a live
external directory). None are destructive.

---

## Example prompts (for the listing / "try it" section)

```
Which personal identity wallets in the FIDES catalog support the PID credential?
```
```
Find relying parties that verify a diploma or education credential.
```
```
Who issues the European Digital Identity (EUDI) PID, and what organizations are behind them?
```
```
Compare two business wallets from the FIDES catalog.
```
```
What credential types are listed in the FIDES ecosystem for the finance sector?
```

---

## Keywords / tags

```
digital identity, EUDI, EUDI wallet, verifiable credentials, SSI,
identity wallet, credential issuer, relying party, eIDAS, FIDES, catalog
```

---

## Branding / assets (to prepare)

- **App icon**: square, ≥ 512×512 PNG (transparent or solid). Use the FIDES mark.
- **Social/OG image** (optional): 1200×630.
- Keep colors consistent with fides.community branding.

---

## Pre-submission checklist

- [x] MCP server live on a stable URL (`/api/mcp`, returns 200 on `tools/list`)
- [x] All tools annotated (`readOnlyHint`, `openWorldHint`)
- [x] Origin allowlist + rate-limiting + security headers in place
- [x] Privacy policy live at `https://fides.community/privacy`
- [ ] Terms of Service live at `https://fides.community/terms`
- [x] Custom-connector flow verified in ChatGPT and Claude
- [ ] Developer / identity verification completed on the OpenAI platform
- [ ] Developer verification completed for the Claude connector directory
- [ ] App metadata + icon uploaded (this document)
- [ ] Reviewed current OpenAI submission terms (incl. any EU data-residency notes)
- [ ] Submitted for review
