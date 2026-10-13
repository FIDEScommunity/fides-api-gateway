import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyTs11Path } from "../lib/proxyTs11";

/**
 * TS11 JWKS — `/api/jwks` and `/.well-known/jwks.json` (via rewrite).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyTs11Path(req, res, "/api/jwks");
}
