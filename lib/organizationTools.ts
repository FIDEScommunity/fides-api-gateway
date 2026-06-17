/**
 * Organization-catalog MCP tools.
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
  organizationExplorerUrl,
  type ToolServer,
  upstreamGet,
} from "./catalogClient";

const ORIGIN_ENV = CATALOGS.organization.originEnv;

interface RawTrustService {
  code?: string;
  name?: string;
}

interface RawCertification {
  code?: string;
  details?: { trustServices?: RawTrustService[] };
}

interface RawOrganization {
  id?: string;
  name?: string;
  legalName?: string;
  description?: string;
  website?: string;
  country?: string;
  sectors?: string[];
  ecosystemRoles?: unknown;
  certifications?: RawCertification[];
}

function apiDetailUrl(id: string): string {
  return gatewayUrl(`/api/public/organization/${encodeURIComponent(id)}`);
}

/**
 * Flatten certifications into compact codes plus the qualified trust-service
 * codes they carry (e.g. ["qtsp"] + ["QEAA", "Q_WAC"]), so the assistant can
 * tell which QTSPs may issue QEAAs without a follow-up get_organization call.
 */
function summarizeCertifications(certs?: RawCertification[]): {
  certifications?: string[];
  trustServices?: string[];
} {
  if (!certs?.length) return {};
  const codes = new Set<string>();
  const services = new Set<string>();
  for (const c of certs) {
    if (c.code) codes.add(c.code);
    for (const ts of c.details?.trustServices ?? []) {
      if (ts.code) services.add(ts.code);
    }
  }
  return {
    certifications: codes.size ? Array.from(codes) : undefined,
    trustServices: services.size ? Array.from(services) : undefined,
  };
}

function summarize(o: RawOrganization): Record<string, unknown> {
  const id = o.id ?? "";
  return {
    id,
    name: o.name ?? o.legalName,
    country: o.country,
    sectors: o.sectors,
    ecosystemRoles: o.ecosystemRoles,
    website: o.website,
    ...summarizeCertifications(o.certifications),
    detailUrl: id ? organizationExplorerUrl(id) : undefined,
    apiUrl: id ? apiDetailUrl(id) : undefined,
  };
}

interface SearchArgs {
  search?: string;
  country?: string;
  role?: "issuer" | "credential" | "wallet" | "rp";
  certification?: string;
  trustService?: string;
  sort?: "name" | "country" | "updatedAt";
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
    .describe("Full-text search on name, legal name, description"),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 country code, e.g. 'NL'"),
  role: z
    .enum(["issuer", "credential", "wallet", "rp"])
    .optional()
    .describe("Ecosystem role filter"),
  certification: z
    .string()
    .optional()
    .describe("Comma-separated certifications, e.g. 'iso27001,qtsp'"),
  trustService: z
    .string()
    .optional()
    .describe(
      "Comma-separated qualified trust-service codes carried by a QTSP " +
        "certification (OR semantics). Use 'QEAA' to find QTSPs that may " +
        "issue Qualified Electronic Attestations of Attributes; other codes " +
        "include Q_WAC, Q_CERT_ESIG, Q_CERT_ESEAL, Q_TIMESTAMP.",
    ),
  sort: z.enum(["name", "country", "updatedAt"]).optional().describe("Sort field"),
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
  id: z.string().describe("Organization catalog id, e.g. 'org:animo'"),
};

export function registerOrganizationTools(server: ToolServer): void {
  server.tool(
    "search_organizations",
    "Search the FIDES organization catalog for organizations and their " +
      "ecosystem roles (issuer, credential, wallet, relying party). This is " +
      "also the catalog for Qualified Trust Service Providers (QTSPs) and the " +
      "qualified trust services they may provide per the EU eIDAS Trust List " +
      "— e.g. to answer 'which QTSPs may issue QEAAs?' use " +
      "trustService='QEAA' (optionally with certification='qtsp'). Filter by " +
      "free-text, country, role, certification, and trustService. Results " +
      "include each organization's certification and trust-service codes. " +
      "Returns a compact, paginated list with canonical detail URLs.",
    searchSchema,
    readOnlyTool("Search organizations"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchArgs;
      const params = new URLSearchParams();
      appendParam(params, "search", args.search);
      appendParam(params, "country", args.country);
      appendParam(params, "role", args.role);
      // certification supports OR semantics via repeated params.
      if (typeof args.certification === "string" && args.certification.trim()) {
        for (const c of args.certification.split(",").map((s) => s.trim())) {
          if (c) params.append("certification", c);
        }
      }
      // trustService likewise supports OR semantics via repeated params.
      if (typeof args.trustService === "string" && args.trustService.trim()) {
        for (const t of args.trustService.split(",").map((s) => s.trim())) {
          if (t) params.append("trustService", t);
        }
      }
      appendParam(params, "sort", args.sort);
      appendParam(params, "direction", args.direction);
      params.set("page", String(args.page ?? 0));
      params.set("size", String(args.size ?? 20));

      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/organization?${params.toString()}`,
      );
      if (!result.ok) return errorContent(result.data);

      const pageData = normalizePage(result.data);
      return jsonContent({
        totalElements: pageData.totalElements ?? pageData.content.length,
        totalPages: pageData.totalPages,
        page: pageData.page ?? args.page ?? 0,
        size: pageData.size ?? args.size ?? 20,
        listUrl: gatewayUrl(`/api/public/organization?${params.toString()}`),
        organizations: pageData.content.map((o) =>
          summarize(o as RawOrganization),
        ),
      });
    },
  );

  server.tool(
    "get_organization",
    "Get full details of a single FIDES organization by its catalog id " +
      "(from search_organizations), e.g. 'org:animo'.",
    getSchema,
    readOnlyTool("Get organization"),
    async (rawArgs) => {
      const args = rawArgs as unknown as GetArgs;
      const result = await upstreamGet(
        ORIGIN_ENV,
        `/api/public/organization/${encodeURIComponent(args.id)}`,
      );
      if (!result.ok) {
        return errorContent({
          ...(typeof result.data === "object" && result.data
            ? result.data
            : { error: "Organization not found" }),
          requested: { id: args.id },
        });
      }
      const org = result.data as RawOrganization;
      return jsonContent({
        ...org,
        detailUrl: organizationExplorerUrl(args.id),
        apiUrl: apiDetailUrl(args.id),
      });
    },
  );
}
