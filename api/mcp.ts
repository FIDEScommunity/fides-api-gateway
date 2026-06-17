/**
 * MCP server endpoint for the FIDES Ecosystem Explorer.
 *
 * Streamable HTTP transport via `mcp-handler`, served as a Vercel Web Handler.
 * Because this file lives at `api/mcp.ts`, the served path is `/api/mcp`, so we
 * set basePath "/api" (mcp-handler matches `${basePath}/mcp` exactly).
 *
 * Connector URL: https://<gateway-host>/api/mcp
 *
 * Stateless mode (Vercel functions share no memory between invocations) is the
 * mcp-handler default and is correct for these read-only tools — no Redis.
 *
 * Tools cover all configured catalogs (wallet, credential, organization,
 * issuer) plus generic federated search/fetch. See
 * docs/MCP-IMPLEMENTATION-PLAN.md for the full Phase 1 design.
 */

import { createMcpHandler } from "mcp-handler";
import { registerAllTools } from "../lib/catalogTools";
import { withMcpGuards } from "../lib/mcpGuards";

export const runtime = "nodejs";

const mcpHandler = createMcpHandler(
  (server) => {
    // Cast through `unknown` so tsc does not compare the SDK's heavy McpServer
    // generics against our minimal ToolServer surface (avoids TS2589 / OOM).
    registerAllTools(
      server as unknown as Parameters<typeof registerAllTools>[0],
    );
  },
  {
    serverInfo: {
      name: "fides-ecosystem-explorer",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
    disableSse: true,
  },
);

// Origin allowlist + best-effort rate limiting + hardening headers.
const handler = withMcpGuards(mcpHandler as unknown as Parameters<typeof withMcpGuards>[0]);

export { handler as GET, handler as POST, handler as DELETE };
