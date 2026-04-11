import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyWithPathRewrite } from "../../lib/proxyUpstream";

/** Issuer OpenAPI — upstream is /api/public/api-docs on the issuer catalog project. */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyWithPathRewrite(
    req,
    res,
    process.env.FIDES_ISSUER_CATALOG_ORIGIN,
    "FIDES_ISSUER_CATALOG_ORIGIN",
    "/api/public/api-docs",
  );
}
