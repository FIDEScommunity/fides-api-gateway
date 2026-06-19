/**
 * Shared helpers for the FIDES catalog MCP tool layer.
 *
 * Every catalog tool (wallet, credential, organization, issuer) and the generic
 * federated search/fetch tools build on these helpers, so catalog access logic
 * lives in exactly one place. The same layer can be reused by the homepage chat
 * endpoint (Phase 2).
 *
 * Typing note: the MCP SDK's `server.tool()` is heavily overloaded and infers
 * argument types from a zod shape, which makes `tsc` instantiate types so deeply
 * that it errors (TS2589) / runs out of memory. We therefore depend only on the
 * minimal `ToolServer` surface below and type each tool's arguments explicitly.
 */

import type { z } from "zod";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * MCP tool annotations (hints). Required for ChatGPT App submission so the
 * model and clients can reason about tool safety. See
 * https://developers.openai.com/apps-sdk/app-submission-guidelines.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Shared annotations for every tool in this server: all tools are read-only
 * queries over the public FIDES catalogs (an open, externally-changing dataset),
 * never mutate state, and are safe to retry.
 */
export const READ_ONLY_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Build read-only annotations with a human-friendly title. */
export function readOnlyTool(title: string): ToolAnnotations {
  return { ...READ_ONLY_TOOL, title };
}

/** Minimal MCP server surface we depend on (avoids the SDK's heavy generics). */
export interface ToolServer {
  tool(
    name: string,
    description: string,
    paramsSchema: Record<string, z.ZodTypeAny>,
    annotations: ToolAnnotations,
    cb: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>,
  ): void;
}

const DEFAULT_GATEWAY_ORIGIN = "https://api.fides.community";
const DEFAULT_SITE_ORIGIN = "https://fides.community";

export function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** Public gateway origin, used to build the raw JSON API links (apiUrl). */
export function gatewayOrigin(): string {
  const v = process.env.GATEWAY_PUBLIC_ORIGIN;
  return v && /^https?:\/\//i.test(v) ? trimSlash(v) : DEFAULT_GATEWAY_ORIGIN;
}

export function gatewayUrl(pathAndQuery: string): string {
  const pq = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${gatewayOrigin()}${pq}`;
}

/**
 * Public FIDES website origin, where the human-facing Ecosystem Explorer pages
 * live. Used to build the canonical deep-link `detailUrl` returned to the model
 * and rendered as chat source cards (e.g. /ecosystem-explorer/...?wallet=id).
 */
export function siteOrigin(): string {
  const v = process.env.FIDES_SITE_ORIGIN;
  return v && /^https?:\/\//i.test(v) ? trimSlash(v) : DEFAULT_SITE_ORIGIN;
}

/** Canonical Explorer page paths and deep-link params per catalog type. */
export const EXPLORER_PATHS = {
  walletPersonal: "/ecosystem-explorer/personal-wallets/",
  walletBusiness: "/ecosystem-explorer/organizational-wallets/",
  credential: "/ecosystem-explorer/credential-catalog/",
  issuer: "/ecosystem-explorer/issuer-catalog/",
  rp: "/ecosystem-explorer/relying-party-catalog/",
  organization: "/organizations/",
} as const;

function explorerDeepLink(path: string, param: string, id: string): string {
  return `${siteOrigin()}${path}?${param}=${encodeURIComponent(id)}`;
}

/** Human Explorer deep link for a wallet (personal vs organizational page). */
export function walletExplorerUrl(id: string, type?: string): string {
  const path =
    type === "organizational" || type === "business"
      ? EXPLORER_PATHS.walletBusiness
      : EXPLORER_PATHS.walletPersonal;
  return explorerDeepLink(path, "wallet", id);
}

export function credentialExplorerUrl(id: string): string {
  return explorerDeepLink(EXPLORER_PATHS.credential, "credential", id);
}

export function issuerExplorerUrl(id: string): string {
  return explorerDeepLink(EXPLORER_PATHS.issuer, "issuer", id);
}

export function rpExplorerUrl(id: string): string {
  return explorerDeepLink(EXPLORER_PATHS.rp, "rp", id);
}

export function organizationExplorerUrl(id: string): string {
  return explorerDeepLink(EXPLORER_PATHS.organization, "org", id);
}

/** Resolve and validate an upstream origin from its env var name. */
export function originFor(envName: string): string | undefined {
  const v = process.env[envName];
  return v && /^https?:\/\//i.test(v) ? trimSlash(v) : undefined;
}

export interface UpstreamResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/** Reverse-fetch JSON from a catalog upstream identified by its env var. */
export async function upstreamGet(
  originEnv: string,
  pathAndQuery: string,
): Promise<UpstreamResult> {
  const origin = originFor(originEnv);
  if (!origin) {
    return {
      ok: false,
      status: 503,
      data: {
        error: "Catalog upstream is not configured",
        missingEnv: originEnv,
      },
    };
  }
  const pq = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const started = performance.now();
  try {
    const res = await fetch(`${origin}${pq}`, {
      headers: { Accept: "application/json" },
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    // Per-upstream timing so we can see catalog cold starts / slow responses.
    console.log(
      `[fides-timing] upstream ${Math.round(performance.now() - started)}ms ` +
        `status=${res.status} ${originEnv} ${pq}`,
    );
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    console.log(
      `[fides-timing] upstream ${Math.round(performance.now() - started)}ms ` +
        `FAILED ${originEnv} ${pq}`,
    );
    return {
      ok: false,
      status: 502,
      data: {
        error: "Failed to reach catalog upstream",
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

export function jsonContent(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorContent(value: unknown): ToolResult {
  return { ...jsonContent(value), isError: true };
}

export function appendParam(
  params: URLSearchParams,
  key: string,
  value?: string,
): void {
  if (typeof value === "string" && value.trim()) {
    params.set(key, value.trim());
  }
}

export interface NormalizedPage {
  content: Record<string, unknown>[];
  totalElements?: number;
  totalPages?: number;
  page?: number;
  size?: number;
}

/**
 * Normalize the two pagination shapes used across catalogs:
 * - flat: `{ content, totalElements, totalPages, number, size }` (org/issuer/wallet)
 * - nested: `{ content, page: { size, number, totalElements, totalPages } }` (credential)
 */
export function normalizePage(data: unknown): NormalizedPage {
  const d = (data ?? {}) as Record<string, unknown>;
  const content = Array.isArray(d.content)
    ? (d.content as Record<string, unknown>[])
    : [];
  const meta =
    d.page && typeof d.page === "object"
      ? (d.page as Record<string, unknown>)
      : d;
  return {
    content,
    totalElements:
      typeof meta.totalElements === "number" ? meta.totalElements : undefined,
    totalPages: typeof meta.totalPages === "number" ? meta.totalPages : undefined,
    page: typeof meta.number === "number" ? meta.number : undefined,
    size: typeof meta.size === "number" ? meta.size : undefined,
  };
}

/* --------------------------------------------------------------------------
 * Federated search/fetch support
 * ------------------------------------------------------------------------ */

export type CatalogType =
  | "wallet"
  | "credential"
  | "organization"
  | "issuer"
  | "rp";

export interface CatalogDef {
  type: CatalogType;
  originEnv: string;
  listPath: string;
  /** Build the upstream list query for a free-text search of given size. */
  searchPathAndQuery: (query: string, size: number) => string;
  /** Build the upstream detail path from a raw item id. */
  detailPathAndQuery: (rawId: string) => string;
  /** Build the raw JSON API URL on the gateway from a raw item id. */
  gatewayDetailUrl: (rawId: string) => string;
  /** Build the canonical human Explorer deep link from a list/detail item. */
  explorerUrlOf: (item: Record<string, unknown>) => string;
  /** Human title for a list/detail item. */
  titleOf: (item: Record<string, unknown>) => string;
  /** Raw id for a list item (used to build result ids). */
  rawIdOf: (item: Record<string, unknown>) => string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const CATALOGS: Record<CatalogType, CatalogDef> = {
  wallet: {
    type: "wallet",
    originEnv: "FIDES_WALLET_CATALOG_ORIGIN",
    listPath: "/api/public/wallet",
    searchPathAndQuery: (q, size) =>
      `/api/public/wallet?search=${encodeURIComponent(q)}&size=${size}`,
    detailPathAndQuery: (rawId) => {
      const [orgId, walletId] = rawId.split("::");
      return `/api/public/wallet/${encodeURIComponent(
        orgId ?? "",
      )}/${encodeURIComponent(walletId ?? "")}`;
    },
    gatewayDetailUrl: (rawId) => {
      const [orgId, walletId] = rawId.split("::");
      return gatewayUrl(
        `/api/public/wallet/${encodeURIComponent(
          orgId ?? "",
        )}/${encodeURIComponent(walletId ?? "")}`,
      );
    },
    explorerUrlOf: (w) => walletExplorerUrl(str(w.id), str(w.type)),
    titleOf: (w) => str(w.name) || str(w.id) || "Wallet",
    rawIdOf: (w) => `${str(w.orgId)}::${str(w.id)}`,
  },
  credential: {
    type: "credential",
    originEnv: "FIDES_CREDENTIAL_CATALOG_ORIGIN",
    listPath: "/api/public/credentialtype",
    searchPathAndQuery: (q, size) =>
      // credential list has no free-text 'search'; tags is the closest filter.
      `/api/public/credentialtype?tags=${encodeURIComponent(q)}&size=${size}`,
    detailPathAndQuery: (rawId) =>
      `/api/public/credentialtype/${encodeURIComponent(rawId)}`,
    gatewayDetailUrl: (rawId) =>
      gatewayUrl(`/api/public/credentialtype/${encodeURIComponent(rawId)}`),
    explorerUrlOf: (c) => credentialExplorerUrl(str(c.id)),
    titleOf: (c) =>
      str(c.displayName) ||
      str(c.schemaInfo) ||
      str(c.id) ||
      str(c.credentialKind) ||
      "Credential type",
    rawIdOf: (c) => str(c.id),
  },
  organization: {
    type: "organization",
    originEnv: "FIDES_ORGANIZATION_CATALOG_ORIGIN",
    listPath: "/api/public/organization",
    searchPathAndQuery: (q, size) =>
      `/api/public/organization?search=${encodeURIComponent(q)}&size=${size}`,
    detailPathAndQuery: (rawId) =>
      `/api/public/organization/${encodeURIComponent(rawId)}`,
    gatewayDetailUrl: (rawId) =>
      gatewayUrl(`/api/public/organization/${encodeURIComponent(rawId)}`),
    explorerUrlOf: (o) => organizationExplorerUrl(str(o.id)),
    titleOf: (o) => str(o.name) || str(o.legalName) || str(o.id) || "Organization",
    rawIdOf: (o) => str(o.id),
  },
  issuer: {
    type: "issuer",
    originEnv: "FIDES_ISSUER_CATALOG_ORIGIN",
    listPath: "/api/public/issuer",
    searchPathAndQuery: (q, size) =>
      `/api/public/issuer?search=${encodeURIComponent(q)}&size=${size}`,
    detailPathAndQuery: (rawId) =>
      `/api/public/issuer/${encodeURIComponent(rawId)}`,
    gatewayDetailUrl: (rawId) =>
      gatewayUrl(`/api/public/issuer/${encodeURIComponent(rawId)}`),
    explorerUrlOf: (i) => issuerExplorerUrl(str(i.id)),
    titleOf: (i) => str(i.displayName) || str(i.id) || "Issuer",
    rawIdOf: (i) => str(i.id),
  },
  rp: {
    type: "rp",
    originEnv: "FIDES_RP_CATALOG_ORIGIN",
    listPath: "/api/public/rp",
    searchPathAndQuery: (q, size) =>
      `/api/public/rp?search=${encodeURIComponent(q)}&size=${size}`,
    detailPathAndQuery: (rawId) => `/api/public/rp/${encodeURIComponent(rawId)}`,
    gatewayDetailUrl: (rawId) =>
      gatewayUrl(`/api/public/rp/${encodeURIComponent(rawId)}`),
    explorerUrlOf: (r) => rpExplorerUrl(str(r.id)),
    titleOf: (r) => str(r.name) || str(r.id) || "Relying party",
    rawIdOf: (r) => str(r.id),
  },
};

/** Build a composite result id like "wallet:org:animo::paradym" or "issuer:iss:...". */
export function makeResultId(type: CatalogType, rawId: string): string {
  return `${type}:${rawId}`;
}

/** Parse a composite result id back into a catalog type and its raw id. */
export function parseResultId(
  id: string,
): { type: CatalogType; rawId: string } | null {
  const idx = id.indexOf(":");
  if (idx === -1) return null;
  const type = id.slice(0, idx) as CatalogType;
  const rawId = id.slice(idx + 1);
  if (!CATALOGS[type]) return null;
  return { type, rawId };
}
