import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyWithPathRewrite } from "../../lib/proxyUpstream";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await proxyWithPathRewrite(
    req,
    res,
    process.env.FIDES_WALLET_CATALOG_ORIGIN,
    "FIDES_WALLET_CATALOG_ORIGIN",
    "/api/public/api-docs",
  );
}
