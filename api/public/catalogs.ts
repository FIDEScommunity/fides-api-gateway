import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  GATEWAY_CATALOG_ROUTES,
  GATEWAY_MCP_PATH,
  isCatalogConfigured,
} from "../../lib/gatewayCatalogs";
import { applyCors } from "../../lib/proxyUpstream";

/**
 * Discovery: which catalog routes are configured on this gateway deployment.
 * Data comes from `lib/gatewayCatalogs.ts` — update that module when API paths change
 * (see README.md → “Maintaining discovery”).
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.status(405).json({
      message: "Method not allowed",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    mcp: {
      path: GATEWAY_MCP_PATH,
      transport: "streamable-http",
      description:
        "MCP server for the FIDES Ecosystem Explorer (add as an AI connector).",
    },
    catalogs: GATEWAY_CATALOG_ROUTES.map((route) => ({
      id: route.id,
      configured: isCatalogConfigured(route),
      listPath: route.listPath,
      detailPathPattern: route.detailPathPattern,
      openApiPath: route.openApiPath,
      swaggerPath: route.swaggerPath,
      ...(route.legacyOpenApiPath
        ? { legacyOpenApiPath: route.legacyOpenApiPath }
        : {}),
      ...(route.legacySwaggerPath
        ? { legacySwaggerPath: route.legacySwaggerPath }
        : {}),
    })),
  });
}
