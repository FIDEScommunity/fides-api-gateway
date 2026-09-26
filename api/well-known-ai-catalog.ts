import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../lib/proxyUpstream";

const AI_CATALOG_MEDIA_TYPE = "application/ai-catalog+json";

function getRequestOrigin(req: VercelRequest): string {
  const host = req.headers.host ?? "localhost";
  const raw =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"]
      : null) ?? "https";
  const proto = raw.split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

/**
 * Draft AI Catalog used for domain-level discovery of the gateway MCP server.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "HEAD") {
    res.setHeader("Content-Type", AI_CATALOG_MEDIA_TYPE);
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    res.status(405).json({
      message: "Method not allowed",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const origin = getRequestOrigin(req);
  const body = {
    specVersion: "1.0",
    entries: [
      {
        identifier: "urn:air:fides.community:mcp:ecosystem-explorer",
        type: "application/mcp-server-card+json",
        url: `${origin}/api/mcp/server-card`,
      },
    ],
  };
  res.setHeader("Content-Type", AI_CATALOG_MEDIA_TYPE);
  res.status(200).send(JSON.stringify(body));
}
