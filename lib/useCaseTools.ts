/**
 * Use-case-catalog MCP tools.
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
  useCaseExplorerUrl,
  type ToolServer,
  upstreamGet,
} from "./catalogClient";

const ORIGIN_ENV = CATALOGS.usecase.originEnv;

interface RawUseCase {
  id?: string;
  title?: string;
  summary?: string;
  sector?: string;
  organizationName?: string;
  country?: string;
  productionDeployment?: string;
  status?: string;
  interactionModes?: string[];
  vcFormats?: string[];
  tags?: string[];
  moreInfoUrl?: string;
}

function apiDetailUrl(id: string): string {
  return gatewayUrl(`/api/public/usecase/${encodeURIComponent(id)}`);
}

function summarize(u: RawUseCase): Record<string, unknown> {
  const id = u.id ?? "";
  return {
    id,
    title: u.title,
    summary: u.summary,
    sector: u.sector,
    organizationName: u.organizationName,
    country: u.country,
    productionDeployment: u.productionDeployment,
    status: u.status,
    interactionModes: u.interactionModes,
    vcFormats: u.vcFormats,
    tags: u.tags,
    moreInfoUrl: u.moreInfoUrl,
    detailUrl: id ? useCaseExplorerUrl(id) : undefined,
    apiUrl: id ? apiDetailUrl(id) : undefined,
  };
}

interface SearchArgs {
  search?: string;
  country?: string;
  sector?: string;
  vcFormat?: string;
  interactionMode?: string;
  tag?: string;
  productionDeployment?: "yes" | "no";
  sort?: "title" | "country" | "updatedAt" | "organizationName";
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
    .describe("Full-text search on title, summary, organization, or tags"),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 country code, e.g. 'NL'"),
  sector: z
    .string()
    .optional()
    .describe("Comma-separated sector codes (OR), e.g. 'public_sector,mobility'"),
  vcFormat: z
    .string()
    .optional()
    .describe("Comma-separated credential formats used (OR), e.g. 'sd_jwt_vc,mdoc'"),
  interactionMode: z
    .string()
    .optional()
    .describe("Comma-separated interaction modes (OR): proximity, remote, both"),
  tag: z
    .string()
    .optional()
    .describe("Comma-separated tags (OR), e.g. 'age-verification,travel'"),
  productionDeployment: z
    .enum(["yes", "no"])
    .optional()
    .describe("Filter on whether the use case is in production"),
  sort: z
    .enum(["title", "country", "updatedAt", "organizationName"])
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
  id: z
    .string()
    .describe("Use case catalog id, e.g. 'age-verification-online-purchase'"),
};

function appendCsv(params: URLSearchParams, key: string, value?: string): void {
  if (typeof value === "string" && value.trim()) {
    for (const v of value.split(",").map((s) => s.trim())) {
      if (v) params.append(key, v);
    }
  }
}

export function registerUseCaseTools(server: ToolServer): void {
  server.tool(
    "search_use_cases",
    "Search the FIDES use case catalog for real-world verifiable credential " +
      "deployments and demos (e.g. age verification, mobile driver's license " +
      "login, digital travel credentials). Filter by free-text, country, " +
      "sector, credential format, interaction mode, tag, and production status. " +
      "Returns a compact, paginated list with canonical detail URLs.",
    searchSchema,
    readOnlyTool("Search use cases"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchArgs;
      const params = new URLSearchParams();
      appendParam(params, "search", args.search);
      appendParam(params, "country", args.country);
      appendCsv(params, "sector", args.sector);
      appendCsv(params, "vcFormat", args.vcFormat);
      appendCsv(params, "interactionMode", args.interactionMode);
      appendCsv(params, "tag", args.tag);
      appendParam(params, "productionDeployment", args.productionDeployment);
      appendParam(params, "sort", args.sort);
      appendParam(params, "direction", args.direction);
      params.set("page", String(args.page ?? 0));
      params.set("size", String(args.size ?? 20));

      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/usecase?${params.toString()}`,
      );
      if (!result.ok) return errorContent(result.data);

      const pageData = normalizePage(result.data);
      return jsonContent({
        totalElements: pageData.totalElements ?? pageData.content.length,
        totalPages: pageData.totalPages,
        page: pageData.page ?? args.page ?? 0,
        size: pageData.size ?? args.size ?? 20,
        listUrl: gatewayUrl(`/api/public/usecase?${params.toString()}`),
        useCases: pageData.content.map((u) => summarize(u as RawUseCase)),
      });
    },
  );

  server.tool(
    "get_use_case",
    "Get full details of a single FIDES use case by its catalog id " +
      "(from search_use_cases), e.g. 'age-verification-online-purchase'.",
    getSchema,
    readOnlyTool("Get use case"),
    async (rawArgs) => {
      const args = rawArgs as unknown as GetArgs;
      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/usecase/${encodeURIComponent(args.id)}`,
      );
      if (!result.ok) {
        return errorContent({
          ...(typeof result.data === "object" && result.data
            ? result.data
            : { error: "Use case not found" }),
          requested: { id: args.id },
        });
      }
      const useCase = result.data as RawUseCase;
      return jsonContent({
        ...useCase,
        detailUrl: useCaseExplorerUrl(args.id),
        apiUrl: apiDetailUrl(args.id),
      });
    },
  );
}
