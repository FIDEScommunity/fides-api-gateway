import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../lib/proxyUpstream";

/** Wallet catalog filter facets (upstream GET /api/public/filter-options). */
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
