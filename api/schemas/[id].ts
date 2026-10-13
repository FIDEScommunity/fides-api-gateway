import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyTs11Path } from "../../lib/proxyTs11";

/**
 * TS11 SchemaMeta detail — public path `/schemas/{id}` (UUID, type id, or alias).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const raw = req.query.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || typeof id !== "string") {
    res.status(400).json({
      message: "Missing schema id",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  await proxyTs11Path(req, res, `/schemas/${encodeURIComponent(id)}`);
}
