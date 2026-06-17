import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyWithPathRewrite } from "../../lib/proxyUpstream";

/** Relying party OpenAPI — upstream is /api/public/api-docs on the rp catalog project. */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyWithPathRewrite(
    req,
    res,
    process.env.FIDES_RP_CATALOG_ORIGIN,
    "FIDES_RP_CATALOG_ORIGIN",
    "/api/public/api-docs",
  );
}
