import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyWithPathRewrite } from "../../lib/proxyUpstream";

/** Use case OpenAPI — upstream is /api/public/api-docs on the use case catalog project. */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyWithPathRewrite(
    req,
    res,
    process.env.FIDES_USE_CASE_CATALOG_ORIGIN,
    "FIDES_USE_CASE_CATALOG_ORIGIN",
    "/api/public/api-docs",
  );
}
