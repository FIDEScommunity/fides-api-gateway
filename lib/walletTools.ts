/**
 * Wallet-catalog MCP tools.
 *
 * Part of the shared tool layer (see docs/MCP-IMPLEMENTATION-PLAN.md). Shared
 * helpers live in catalogClient.ts; this file only defines the wallet-specific
 * tool surface.
 */

import { z } from "zod";
import {
  appendParam,
  CATALOGS,
  errorContent,
  gatewayUrl,
  jsonContent,
  normalizePage,
  readOnlyTool,
  type ToolServer,
  upstreamGet,
  walletExplorerUrl,
} from "./catalogClient";

const ORIGIN_ENV = CATALOGS.wallet.originEnv;

interface RawWallet {
  id?: string;
  name?: string;
  orgId?: string;
  type?: string;
  status?: string;
  description?: string;
  website?: string;
  openSource?: boolean;
  platforms?: string[];
  vcFormat?: string[];
  capabilities?: string[];
  interoperabilityProfiles?: string[];
  provider?: { name?: string; country?: string; website?: string };
}

function apiDetailUrl(orgId: string, walletId: string): string {
  return gatewayUrl(
    `/api/public/wallet/${encodeURIComponent(orgId)}/${encodeURIComponent(
      walletId,
    )}`,
  );
}

function summarizeWallet(w: RawWallet): Record<string, unknown> {
  const orgId = w.orgId ?? "";
  const id = w.id ?? "";
  return {
    id,
    name: w.name,
    orgId,
    provider: w.provider?.name,
    country: w.provider?.country,
    type: w.type,
    status: w.status,
    openSource: w.openSource,
    platforms: w.platforms,
    vcFormat: w.vcFormat,
    capabilities: w.capabilities,
    interoperabilityProfiles: w.interoperabilityProfiles,
    website: w.website ?? w.provider?.website,
    // Canonical human Explorer deep link; apiUrl is the raw JSON endpoint.
    detailUrl: id ? walletExplorerUrl(id, w.type) : undefined,
    apiUrl: orgId && id ? apiDetailUrl(orgId, id) : undefined,
  };
}

interface SearchWalletsArgs {
  search?: string;
  orgId?: string;
  type?: "personal" | "organizational";
  platforms?: string;
  vcFormat?: string;
  capabilities?: string;
  interoperabilityProfiles?: string;
  protocols?: string;
  openSource?: boolean;
  status?: string;
  sort?: "displayName" | "name" | "id" | "orgId" | "status" | "updatedAt";
  direction?: "asc" | "desc";
  page?: number;
  size?: number;
}

interface GetWalletArgs {
  orgId: string;
  walletId: string;
}

const searchSchema: Record<string, z.ZodTypeAny> = {
  search: z
    .string()
    .optional()
    .describe("Free-text match on wallet name, description, provider, or id"),
  orgId: z
    .string()
    .optional()
    .describe("Exact organization catalog id, e.g. 'org:animo'"),
  type: z.enum(["personal", "organizational"]).optional().describe("Wallet type"),
  platforms: z
    .string()
    .optional()
    .describe("Comma-separated platforms, e.g. 'iOS,Android,Web'"),
  vcFormat: z
    .string()
    .optional()
    .describe("Comma-separated VC formats, e.g. 'sd_jwt_vc,mdoc,vcdm_2_0'"),
  capabilities: z
    .string()
    .optional()
    .describe("Comma-separated capabilities: 'holder,issuer,verifier'"),
  interoperabilityProfiles: z
    .string()
    .optional()
    .describe("Comma-separated profiles, e.g. 'EUDI Wallet ARF,DIIP v5'"),
  protocols: z
    .string()
    .optional()
    .describe("Comma-separated issuance/presentation protocols"),
  openSource: z.boolean().optional().describe("Only open-source wallets"),
  status: z
    .string()
    .optional()
    .describe("Comma-separated status: 'development,beta,production,deprecated'"),
  sort: z
    .enum(["displayName", "name", "id", "orgId", "status", "updatedAt"])
    .optional()
    .describe("Sort field (default: displayName)"),
  direction: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
  page: z.number().int().min(0).optional().describe("Zero-based page (default 0)"),
  size: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Page size, max 50 (default 20)"),
};

const getSchema: Record<string, z.ZodTypeAny> = {
  orgId: z.string().describe("Organization catalog id, e.g. 'org:animo'"),
  walletId: z
    .string()
    .describe("Wallet id within the organization (the 'id' field)"),
};

export function registerWalletTools(server: ToolServer): void {
  server.tool(
    "search_wallets",
    "Search the FIDES wallet catalog for digital identity wallets. Filter by " +
      "free-text query, organization, type, platform, supported credential (VC) " +
      "format, capabilities, interoperability profiles, open-source, and status. " +
      "Returns a compact, paginated list with canonical detail URLs.",
    searchSchema,
    readOnlyTool("Search wallets"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchWalletsArgs;
      const params = new URLSearchParams();
      appendParam(params, "search", args.search);
      appendParam(params, "orgId", args.orgId);
      appendParam(params, "type", args.type);
      appendParam(params, "platforms", args.platforms);
      appendParam(params, "vcFormat", args.vcFormat);
      appendParam(params, "capabilities", args.capabilities);
      appendParam(
        params,
        "interoperabilityProfiles",
        args.interoperabilityProfiles,
      );
      appendParam(params, "protocols", args.protocols);
      appendParam(params, "status", args.status);
      appendParam(params, "sort", args.sort);
      appendParam(params, "direction", args.direction);
      if (typeof args.openSource === "boolean") {
        params.set("openSource", String(args.openSource));
      }
      params.set("page", String(args.page ?? 0));
      params.set("size", String(args.size ?? 20));

      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/wallet?${params.toString()}`,
      );
      if (!result.ok) return errorContent(result.data);

      const pageData = normalizePage(result.data);
      return jsonContent({
        totalElements: pageData.totalElements ?? pageData.content.length,
        totalPages: pageData.totalPages,
        page: pageData.page ?? args.page ?? 0,
        size: pageData.size ?? args.size ?? 20,
        listUrl: gatewayUrl(`/api/public/wallet?${params.toString()}`),
        wallets: pageData.content.map((w) => summarizeWallet(w as RawWallet)),
      });
    },
  );

  server.tool(
    "get_wallet",
    "Get full details of a single FIDES wallet by its organization id and " +
      "wallet id (from search_wallets). Returns the complete record including " +
      "provider, supported credential formats, protocols, key storage, " +
      "certifications, and links.",
    getSchema,
    readOnlyTool("Get wallet"),
    async (rawArgs) => {
      const args = rawArgs as unknown as GetWalletArgs;
      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/wallet/${encodeURIComponent(
          args.orgId,
        )}/${encodeURIComponent(args.walletId)}`,
      );
      if (!result.ok) {
        return errorContent({
          ...(typeof result.data === "object" && result.data
            ? result.data
            : { error: "Wallet not found" }),
          requested: { orgId: args.orgId, walletId: args.walletId },
        });
      }
      const wallet = result.data as RawWallet;
      return jsonContent({
        ...wallet,
        detailUrl: walletExplorerUrl(args.walletId, wallet.type),
        apiUrl: apiDetailUrl(args.orgId, args.walletId),
      });
    },
  );
}
