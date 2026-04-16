import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../../../lib/proxyUpstream";

/**
 * Proxies GET /api/public/wallet/:orgId/:walletId to the wallet catalog.
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
