import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../lib/proxyUpstream";

/** Credential catalog OpenAPI (backward compatible with /api/public/api-docs on api.fides.community). */
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
