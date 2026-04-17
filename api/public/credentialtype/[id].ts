import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../../lib/proxyUpstream";

/**
 * Proxies GET /api/public/credentialtype/:id to the credential catalog.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxySamePath(
    req,
    res,
    process.env.FIDES_CREDENTIAL_CATALOG_ORIGIN,
    "FIDES_CREDENTIAL_CATALOG_ORIGIN",
  );
}
