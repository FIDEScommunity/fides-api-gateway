/**
 * Credential-catalog MCP tools.
 *
 * The credential API differs from the other catalogs:
 * - the format filter param is `vcFormat` (not `credentialFormat`);
 * - `sort` is a single combined "field,direction" string;
 * - pagination is nested under a `page` object;
 * - the DTO has no display name (use `schemaInfo` as a description).
 */

import { z } from "zod";
import {
  appendParam,
  CATALOGS,
  credentialExplorerUrl,
  errorContent,
  gatewayUrl,
  jsonContent,
  normalizePage,
  readOnlyTool,
  type ToolServer,
  upstreamGet,
} from "./catalogClient";

const ORIGIN_ENV = CATALOGS.credential.originEnv;

interface RawCredential {
  id?: string;
  credentialKind?: string;
  vcFormat?: string;
  authority?: string;
  schemaInfo?: string;
  schemaUrl?: string;
  trustFrameworkUrl?: string;
  tags?: string[];
  sectors?: string[];
  ecosystems?: string[];
  themes?: string[];
  category?: string;
  hasIssuers?: boolean;
  issuerCount?: number;
}

function apiDetailUrl(id: string): string {
  return gatewayUrl(`/api/public/credentialtype/${encodeURIComponent(id)}`);
}

function summarize(c: RawCredential): Record<string, unknown> {
  const id = c.id ?? "";
  return {
    id,
    description: c.schemaInfo,
    credentialKind: c.credentialKind,
    vcFormat: c.vcFormat,
    authority: c.authority,
    sectors: c.sectors,
    ecosystems: c.ecosystems,
    themes: c.themes,
    category: c.category,
    tags: c.tags,
    hasIssuers: c.hasIssuers,
    issuerCount: c.issuerCount,
    detailUrl: id ? credentialExplorerUrl(id) : undefined,
    apiUrl: id ? apiDetailUrl(id) : undefined,
  };
}

interface SearchArgs {
  credentialKind?: "PERSONAL" | "ORGANIZATIONAL" | "PRODUCT" | "UNKNOWN";
  vcFormat?: string;
  sector?: string;
  ecosystem?: string;
  theme?: string;
  category?: string;
  tags?: string;
  authority?: string;
  hasIssuers?: boolean;
  sort?: "id" | "vcFormat" | "credentialKind";
  direction?: "asc" | "desc";
  page?: number;
  size?: number;
}

interface GetArgs {
  id: string;
}

const searchSchema: Record<string, z.ZodTypeAny> = {
  credentialKind: z
    .enum(["PERSONAL", "ORGANIZATIONAL", "PRODUCT", "UNKNOWN"])
    .optional()
    .describe("Subject kind of the credential"),
  vcFormat: z
    .string()
    .optional()
    .describe("Comma-separated VC formats, e.g. 'sd_jwt_vc,mdoc'"),
  sector: z
    .string()
    .optional()
    .describe(
      "Comma-separated sector codes, e.g. 'public_sector,finance,healthcare'",
    ),
  ecosystem: z
    .string()
    .optional()
    .describe("Comma-separated ecosystem codes, e.g. 'eudi_wallet,gaia_x'"),
  theme: z
    .string()
    .optional()
    .describe("Comma-separated theme codes, e.g. 'person_identity,payments'"),
  category: z
    .string()
    .optional()
    .describe("Comma-separated category codes, e.g. 'identity,finance,health'"),
  tags: z
    .string()
    .optional()
    .describe("Free-text, case-insensitive partial match on tags"),
  authority: z
    .string()
    .optional()
    .describe("Free-text, case-insensitive partial match on authority name"),
  hasIssuers: z
    .boolean()
    .optional()
    .describe("Only credentials that have (true) or lack (false) known issuers"),
  sort: z
    .enum(["id", "vcFormat", "credentialKind"])
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
    .describe("Credential catalog id, e.g. 'cred:eu:pid-vc-sd-jwt:sd-jwt-vc'"),
};

export function registerCredentialTools(server: ToolServer): void {
  server.tool(
    "search_credential_types",
    "Search the FIDES credential catalog for credential type definitions " +
      "(schema, VC format, subject kind, authority, sectors, ecosystems, " +
      "themes). Note: this returns credential definitions only, not issuers — " +
      "use search_issuers for who issues a credential. Returns a compact, " +
      "paginated list with canonical detail URLs.",
    searchSchema,
    readOnlyTool("Search credential types"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchArgs;
      const params = new URLSearchParams();
      appendParam(params, "credentialKind", args.credentialKind);
      appendParam(params, "vcFormat", args.vcFormat);
      appendParam(params, "sector", args.sector);
      appendParam(params, "ecosystem", args.ecosystem);
      appendParam(params, "theme", args.theme);
      appendParam(params, "category", args.category);
      appendParam(params, "tags", args.tags);
      appendParam(params, "authority", args.authority);
      if (typeof args.hasIssuers === "boolean") {
        params.set("hasIssuers", String(args.hasIssuers));
      }
      if (args.sort) {
        params.set("sort", `${args.sort},${args.direction ?? "asc"}`);
      }
      params.set("page", String(args.page ?? 0));
      params.set("size", String(args.size ?? 20));

      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/credentialtype?${params.toString()}`,
      );
      if (!result.ok) return errorContent(result.data);

      const pageData = normalizePage(result.data);
      return jsonContent({
        totalElements: pageData.totalElements ?? pageData.content.length,
        totalPages: pageData.totalPages,
        page: pageData.page ?? args.page ?? 0,
        size: pageData.size ?? args.size ?? 20,
        listUrl: gatewayUrl(`/api/public/credentialtype?${params.toString()}`),
        credentialTypes: pageData.content.map((c) =>
          summarize(c as RawCredential),
        ),
      });
    },
  );

  server.tool(
    "get_credential_type",
    "Get full details of a single FIDES credential type by its catalog id " +
      "(from search_credential_types).",
    getSchema,
    readOnlyTool("Get credential type"),
    async (rawArgs) => {
      const args = rawArgs as unknown as GetArgs;
      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/credentialtype/${encodeURIComponent(args.id)}`,
      );
      if (!result.ok) {
        return errorContent({
          ...(typeof result.data === "object" && result.data
            ? result.data
            : { error: "Credential type not found" }),
          requested: { id: args.id },
        });
      }
      const credential = result.data as RawCredential;
      return jsonContent({
        ...credential,
        detailUrl: credentialExplorerUrl(args.id),
        apiUrl: apiDetailUrl(args.id),
      });
    },
  );
}
