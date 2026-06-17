/**
 * Generic federated `search` + `fetch` MCP tools.
 *
 * These follow the tool shapes ChatGPT expects for connectors / "Company
 * knowledge" / Deep Research, so the FIDES Ecosystem Explorer works as a
 * citable knowledge source even without per-catalog tools. They fan out across
 * all configured catalogs and return canonical gateway URLs for citations.
 *
 * - search(query) -> { results: [{ id, title, url }] }
 * - fetch(id)     -> { id, title, text, url, metadata }
 *
 * `id` is a composite "<type>:<rawId>" produced by search and consumed by fetch.
 */

import { z } from "zod";
import {
  CATALOGS,
  type CatalogDef,
  type CatalogType,
  errorContent,
  jsonContent,
  makeResultId,
  normalizePage,
  readOnlyTool,
  originFor,
  parseResultId,
  type ToolServer,
  upstreamGet,
} from "./catalogClient";

const PER_CATALOG = 5;

interface SearchArgs {
  query: string;
}

interface FetchArgs {
  id: string;
}

const searchSchema: Record<string, z.ZodTypeAny> = {
  query: z
    .string()
    .describe("Free-text query to search across all FIDES catalogs"),
};

const fetchSchema: Record<string, z.ZodTypeAny> = {
  id: z
    .string()
    .describe("A result id returned by search, e.g. 'wallet:org:animo::paradym'"),
};

async function searchOne(
  def: CatalogDef,
  query: string,
): Promise<{ id: string; title: string; url: string }[]> {
  if (!originFor(def.originEnv)) return [];
  const result = await upstreamGet(
    def.originEnv,
    def.searchPathAndQuery(query, PER_CATALOG),
  );
  if (!result.ok) return [];
  const { content } = normalizePage(result.data);
  return content.map((item) => {
    const rawId = def.rawIdOf(item);
    return {
      id: makeResultId(def.type, rawId),
      title: `[${def.type}] ${def.titleOf(item)}`,
      // Canonical human Explorer deep link (not the raw JSON API URL).
      url: def.explorerUrlOf(item),
    };
  });
}

export function registerGenericTools(server: ToolServer): void {
  server.tool(
    "search",
    "Search across all FIDES catalogs (wallets, credential types, " +
      "organizations, issuers) with a free-text query. Returns a list of " +
      "results with ids and canonical URLs; use the `fetch` tool with a result " +
      "id to retrieve full details.",
    searchSchema,
    readOnlyTool("Search FIDES catalogs"),
    async (rawArgs) => {
      const args = rawArgs as unknown as SearchArgs;
      const query = (args.query ?? "").trim();
      if (!query) {
        return jsonContent({ results: [] });
      }
      const types = Object.keys(CATALOGS) as CatalogType[];
      const batches = await Promise.all(
        types.map((t) => searchOne(CATALOGS[t], query)),
      );
      const results = batches.flat();
      return jsonContent({ results });
    },
  );

  server.tool(
    "fetch",
    "Fetch the full record for a single FIDES catalog item by the result id " +
      "returned from the `search` tool. Returns the document with a canonical " +
      "URL for citation.",
    fetchSchema,
    readOnlyTool("Fetch FIDES record"),
    async (rawArgs) => {
      const args = rawArgs as unknown as FetchArgs;
      const parsed = parseResultId(args.id ?? "");
      if (!parsed) {
        return errorContent({
          error: "Invalid id. Expected '<type>:<rawId>' from the search tool.",
          received: args.id,
        });
      }
      const def = CATALOGS[parsed.type];
      const result = await upstreamGet(
        def.originEnv,
        def.detailPathAndQuery(parsed.rawId),
      );
      if (!result.ok) {
        return errorContent({
          error: "Not found",
          requested: args.id,
          upstreamStatus: result.status,
        });
      }
      const item = (result.data ?? {}) as Record<string, unknown>;
      return jsonContent({
        id: args.id,
        title: def.titleOf(item),
        text: JSON.stringify(item),
        url: def.explorerUrlOf(item),
        apiUrl: def.gatewayDetailUrl(parsed.rawId),
        metadata: { type: parsed.type },
      });
    },
  );
}
