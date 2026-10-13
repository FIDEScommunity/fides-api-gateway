import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyTs11Path } from "../lib/proxyTs11";

/**
 * TS11 SchemaMeta list — public path `/schemas` (rewritten from vercel.json).
 * Proxies to the credential catalog upstream.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyTs11Path(req, res, "/schemas");
}
