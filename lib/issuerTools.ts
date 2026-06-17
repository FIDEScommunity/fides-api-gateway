/**
 * Issuer-catalog MCP tools.
 */

import { z } from "zod";
import {
  appendParam,
  CATALOGS,
  errorContent,
  gatewayUrl,
  issuerExplorerUrl,
  jsonContent,
  normalizePage,
  readOnlyTool,
  type ToolServer,
  upstreamGet,
} from "./catalogClient";

const ORIGIN_ENV = CATALOGS.issuer.originEnv;

interface RawIssuer {
  id?: string;
  orgId?: string;
  displayName?: string;
  description?: string;
  environment?: string;
  credentialIssuerUrl?: string;
  issuerWebsiteUrl?: string;
  organization?: { name?: string; country?: string };
  credentialConfigurations?: unknown[];
}

function apiDetailUrl(id: string): string {
  return gatewayUrl(`/api/public/issuer/${encodeURIComponent(id)}`);
}

function summarize(i: RawIssuer): Record<string, unknown> {
  const id = i.id ?? "";
  const configs = Array.isArray(i.credentialConfigurations)
    ? i.credentialConfigurations.length
    : 0;
  return {
    id,
    displayName: i.displayName,
    orgId: i.orgId,
    organization: i.organization?.name,
    country: i.organization?.country,
    environment: i.environment,
    credentialIssuerUrl: i.credentialIssuerUrl,
    website: i.issuerWebsiteUrl,
    credentialConfigurationCount: configs,
    detailUrl: id ? issuerExplorerUrl(id) : undefined,
    apiUrl: id ? apiDetailUrl(id) : undefined,
  };
}

interface SearchArgs {
  search?: string;
  environment?: string;
  orgId?: string;
  vcFormat?: string;
  credentialCatalogId?: string;
  subjectType?: string;
  tags?: string;
  country?: string;
  sort?: "displayName" | "environment" | "id" | "orgId" | "updatedAt";
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
      "Free-text across id, orgId, display name, description, URLs, org name, " +
        "and credential configuration fields",
    ),
  environment: z
    .string()
    .optional()
    .describe("Exact environment match, e.g. 'test' or 'production'"),
  orgId: z
    .string()
    .optional()
    .describe("Exact organization catalog id, e.g. 'org:animo'"),
  vcFormat: z
    .string()
    .optional()
    .describe("Issuer has a configuration with this VC format, e.g. 'sd_jwt_vc'"),
  credentialCatalogId: z
    .string()
    .optional()
    .describe(
      "Issuer issues this FIDES credential catalog id, e.g. " +
        "'cred:eu:pid-vc-sd-jwt:sd-jwt-vc'",
    ),
  subjectType: z
    .string()
    .optional()
    .describe("Issuer has a configuration with this subject type, e.g. 'Person'"),
  tags: z
    .string()
    .optional()
    .describe("Free-text, case-insensitive partial match on tags"),
  country: z
    .string()
    .optional()
    .describe("Exact ISO country code of the issuer organization, e.g. 'NL'"),
  sort: z
    .enum(["displayName", "environment", "id", "orgId", "updatedAt"])
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
  id: z.string().describe("Issuer catalog id (from search_issuers)"),
};

export function registerIssuerTools(server: ToolServer): void {
  server.tool(
    "search_issuers",
    "Search the FIDES issuer catalog for credential issuers — who issues which " +
      "credentials, in which environment, with which configurations. Filter by " +
      "free-text, environment, organization, VC format, credential catalog id, " +
      "subject type, tags, and country. Returns a compact, paginated list with " +
      "canonical detail URLs.",
    searchSchema,
    readOnlyTool("Search issuers"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchArgs;
      const params = new URLSearchParams();
      appendParam(params, "search", args.search);
      appendParam(params, "environment", args.environment);
      appendParam(params, "orgId", args.orgId);
      appendParam(params, "vcFormat", args.vcFormat);
      appendParam(params, "credentialCatalogId", args.credentialCatalogId);
      appendParam(params, "subjectType", args.subjectType);
      appendParam(params, "tags", args.tags);
      appendParam(params, "country", args.country);
      appendParam(params, "sort", args.sort);
      appendParam(params, "direction", args.direction);
      params.set("page", String(args.page ?? 0));
      params.set("size", String(args.size ?? 20));

      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/issuer?${params.toString()}`,
      );
      if (!result.ok) return errorContent(result.data);

      const pageData = normalizePage(result.data);
      return jsonContent({
        totalElements: pageData.totalElements ?? pageData.content.length,
        totalPages: pageData.totalPages,
        page: pageData.page ?? args.page ?? 0,
        size: pageData.size ?? args.size ?? 20,
        listUrl: gatewayUrl(`/api/public/issuer?${params.toString()}`),
        issuers: pageData.content.map((i) => summarize(i as RawIssuer)),
      });
    },
  );

  server.tool(
    "get_issuer",
    "Get full details of a single FIDES issuer by its catalog id " +
      "(from search_issuers), including credential configurations and URLs.",
    getSchema,
    readOnlyTool("Get issuer"),
    async (rawArgs) => {
      const args = rawArgs as unknown as GetArgs;
      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/issuer/${encodeURIComponent(args.id)}`,
      );
      if (!result.ok) {
        return errorContent({
          ...(typeof result.data === "object" && result.data
            ? result.data
            : { error: "Issuer not found" }),
          requested: { id: args.id },
        });
      }
      const issuer = result.data as RawIssuer;
      return jsonContent({
        ...issuer,
        detailUrl: issuerExplorerUrl(args.id),
        apiUrl: apiDetailUrl(args.id),
      });
    },
  );
}
