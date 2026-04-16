import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../../lib/proxyUpstream";

/**
 * Proxies GET /api/public/wallet to the wallet catalog (list + query params).
 * Uses index.ts instead of [[...slug]] so /api/public/wallet resolves on Vercel.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxySamePath(
    req,
    res,
    process.env.FIDES_WALLET_CATALOG_ORIGIN,
    "FIDES_WALLET_CATALOG_ORIGIN",
  );
}
