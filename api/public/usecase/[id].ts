import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../../lib/proxyUpstream";

/**
 * Proxies GET /api/public/usecase/:id to the use case catalog.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxySamePath(
    req,
    res,
    process.env.FIDES_USE_CASE_CATALOG_ORIGIN,
    "FIDES_USE_CASE_CATALOG_ORIGIN",
  );
}
