import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../lib/proxyUpstream";

/** Wallet catalog stats (upstream GET /api/public/stats). */
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
