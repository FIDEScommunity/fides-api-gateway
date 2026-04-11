import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxySamePath } from "../../lib/proxyUpstream";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxySamePath(
    req,
    res,
    process.env.FIDES_ISSUER_CATALOG_ORIGIN,
    "FIDES_ISSUER_CATALOG_ORIGIN",
  );
}
