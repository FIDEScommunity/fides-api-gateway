import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../../lib/proxyUpstream";

/**
 * Proxies GET /api/public/organization/:id to the organization catalog.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxySamePath(
    req,
    res,
    process.env.FIDES_ORGANIZATION_CATALOG_ORIGIN,
    "FIDES_ORGANIZATION_CATALOG_ORIGIN",
  );
}
