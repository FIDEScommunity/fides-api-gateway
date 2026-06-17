/**
 * Relying-party-catalog MCP tools.
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
  rpExplorerUrl,
  type ToolServer,
  upstreamGet,
} from "./catalogClient";

const ORIGIN_ENV = CATALOGS.rp.originEnv;

interface RawRelyingParty {
  id?: string;
  name?: string;
  description?: string;
  website?: string;
  country?: string;
  readiness?: string;
  status?: string;
  interactionMode?: string;
  sectors?: string[];
  vcFormat?: string[];
  interoperabilityProfiles?: string[];
  orgId?: string;
  provider?: { name?: string };
  isFeatured?: boolean;
}

function apiDetailUrl(id: string): string {
  return gatewayUrl(`/api/public/rp/${encodeURIComponent(id)}`);
}

function summarize(r: RawRelyingParty): Record<string, unknown> {
  const id = r.id ?? "";
  return {
    id,
    name: r.name,
    country: r.country,
    readiness: r.readiness,
    status: r.status,
    interactionMode: r.interactionMode,
    sectors: r.sectors,
    vcFormat: r.vcFormat,
    orgId: r.orgId,
    provider: r.provider?.name,
    website: r.website,
    detailUrl: id ? rpExplorerUrl(id) : undefined,
    apiUrl: id ? apiDetailUrl(id) : undefined,
  };
}

interface SearchArgs {
  search?: string;
  country?: string;
  orgId?: string;
  readiness?: string;
  status?: string;
  interactionMode?: "proximity" | "remote" | "both";
  sector?: string;
  vcFormat?: string;
  featured?: boolean;
  sort?: "name" | "readiness" | "country" | "updatedAt";
  direction?: "asc" | "desc";
  page?: number;
  size?: number;
}

interface GetArgs {
  id: string;
}

const searchSchema: Record<string, z.ZodTypeAny> = {
  search: z
    .string()
    .optional()
    .describe(
      "Full-text search on name, description, provider, website, or accepted credentials",
    ),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 country code, e.g. 'NL'"),
  orgId: z
    .string()
    .optional()
    .describe("Owning organization id, e.g. 'org:air-new-zealand'"),
  readiness: z
    .string()
    .optional()
    .describe(
      "Comma-separated readiness levels (OR): technical-demo, use-case-demo, production-pilot, production",
    ),
  status: z
    .string()
    .optional()
    .describe("Comma-separated status values (OR): development, beta, live, deprecated"),
  interactionMode: z
    .enum(["proximity", "remote", "both"])
    .optional()
    .describe("Interaction mode filter"),
  sector: z
    .string()
    .optional()
    .describe("Comma-separated sector codes (OR), e.g. 'public_sector,mobility'"),
  vcFormat: z
    .string()
    .optional()
    .describe("Comma-separated accepted credential formats (OR), e.g. 'sd_jwt_vc,mdoc'"),
  featured: z.boolean().optional().describe("When true, only featured relying parties"),
  sort: z
    .enum(["name", "readiness", "country", "updatedAt"])
    .optional()
    .describe("Sort field"),
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
  id: z.string().describe("Relying party catalog id, e.g. 'air-new-zealand'"),
};

function appendCsv(params: URLSearchParams, key: string, value?: string): void {
  if (typeof value === "string" && value.trim()) {
    for (const v of value.split(",").map((s) => s.trim())) {
      if (v) params.append(key, v);
    }
  }
}

export function registerRpTools(server: ToolServer): void {
  server.tool(
    "search_relying_parties",
    "Search the FIDES relying party catalog for verifier websites and " +
      "services that accept verifiable credentials. Filter by free-text, " +
      "country, owning organization, readiness, status, interaction mode, " +
      "sector, and accepted credential format. Returns a compact, paginated " +
      "list with canonical detail URLs.",
    searchSchema,
    readOnlyTool("Search relying parties"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchArgs;
      const params = new URLSearchParams();
      appendParam(params, "search", args.search);
      appendParam(params, "country", args.country);
      appendParam(params, "orgId", args.orgId);
      appendCsv(params, "readiness", args.readiness);
      appendCsv(params, "status", args.status);
      appendParam(params, "interactionMode", args.interactionMode);
      appendCsv(params, "sector", args.sector);
      appendCsv(params, "vcFormat", args.vcFormat);
      if (args.featured === true) params.set("featured", "true");
      appendParam(params, "sort", args.sort);
      appendParam(params, "direction", args.direction);
      params.set("page", String(args.page ?? 0));
      params.set("size", String(args.size ?? 20));

      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/rp?${params.toString()}`,
      );
      if (!result.ok) return errorContent(result.data);

      const pageData = normalizePage(result.data);
      return jsonContent({
        totalElements: pageData.totalElements ?? pageData.content.length,
        totalPages: pageData.totalPages,
        page: pageData.page ?? args.page ?? 0,
        size: pageData.size ?? args.size ?? 20,
        listUrl: gatewayUrl(`/api/public/rp?${params.toString()}`),
        relyingParties: pageData.content.map((r) =>
          summarize(r as RawRelyingParty),
        ),
      });
    },
  );

  server.tool(
    "get_relying_party",
    "Get full details of a single FIDES relying party by its catalog id " +
      "(from search_relying_parties), e.g. 'air-new-zealand'.",
    getSchema,
    readOnlyTool("Get relying party"),
    async (rawArgs) => {
      const args = rawArgs as unknown as GetArgs;
      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/rp/${encodeURIComponent(args.id)}`,
      );
      if (!result.ok) {
        return errorContent({
          ...(typeof result.data === "object" && result.data
            ? result.data
            : { error: "Relying party not found" }),
          requested: { id: args.id },
        });
      }
      const rp = result.data as RawRelyingParty;
      return jsonContent({
        ...rp,
        detailUrl: rpExplorerUrl(args.id),
        apiUrl: apiDetailUrl(args.id),
      });
    },
  );
}
