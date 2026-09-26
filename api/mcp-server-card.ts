import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../lib/proxyUpstream";

const SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json";

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
 * Draft MCP Server Card for the FIDES Ecosystem Explorer.
 *
 * Served at `/api/mcp/server-card`, relative to the Streamable HTTP endpoint.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "HEAD") {
    res.setHeader("Content-Type", SERVER_CARD_MEDIA_TYPE);
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
    $schema:
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "community.fides/fides-ecosystem-explorer",
    title: "FIDES Ecosystem Explorer",
    description: "Search and retrieve public FIDES ecosystem catalogs.",
    version: "1.0.0",
    websiteUrl: "https://fides.community/",
    remotes: [
      {
        type: "streamable-http",
        url: `${origin}/api/mcp`,
      },
    ],
  };
  res.setHeader("Content-Type", SERVER_CARD_MEDIA_TYPE);
  res.status(200).send(JSON.stringify(body));
}
