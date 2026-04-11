import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../lib/proxyUpstream";

/**
 * Discovery: which catalog routes are configured on this gateway deployment.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.status(405).json({
      message: "Method not allowed",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const credentialOrigin = !!process.env.FIDES_CREDENTIAL_CATALOG_ORIGIN;
  const organizationOrigin = !!process.env.FIDES_ORGANIZATION_CATALOG_ORIGIN;

  res.status(200).json({
    catalogs: [
      {
        id: "credential",
        configured: credentialOrigin,
        listPath: "/api/public/credentialtype",
        openApiPath: "/api/public/api-docs",
        swaggerPath: "/swagger.html",
      },
      {
        id: "organization",
        configured: organizationOrigin,
        listPath: "/api/public/organization",
        openApiPath: "/api/public/organization-api-docs",
        swaggerPath: "/swagger-organization.html",
      },
    ],
  });
}
