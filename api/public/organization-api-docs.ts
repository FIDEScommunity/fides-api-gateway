import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyWithPathRewrite } from "../../lib/proxyUpstream";

/** Organization OpenAPI — upstream is /api/public/api-docs on the organization catalog project. */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyWithPathRewrite(
    req,
    res,
    process.env.FIDES_ORGANIZATION_CATALOG_ORIGIN,
    "FIDES_ORGANIZATION_CATALOG_ORIGIN",
    "/api/public/api-docs",
  );
}
