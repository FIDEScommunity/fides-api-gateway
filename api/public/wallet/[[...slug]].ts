import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../../lib/proxyUpstream";

/**
 * Proxies /api/public/wallet and /api/public/wallet/:orgId/:walletId (and deeper) to the wallet catalog deployment.
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
