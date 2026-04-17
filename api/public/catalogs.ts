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
  const issuerOrigin = !!process.env.FIDES_ISSUER_CATALOG_ORIGIN;
  const walletOrigin = !!process.env.FIDES_WALLET_CATALOG_ORIGIN;

  res.status(200).json({
    catalogs: [
      {
        id: "credential",
        configured: credentialOrigin,
        listPath: "/api/public/credentialtype",
        detailPathPattern: "/api/public/credentialtype/{id}",
        openApiPath: "/api/public/credential-api-docs",
        swaggerPath: "/swagger-credentialtype.html",
        legacyOpenApiPath: "/api/public/api-docs",
        legacySwaggerPath: "/swagger.html",
      },
      {
        id: "organization",
        configured: organizationOrigin,
        listPath: "/api/public/organization",
        detailPathPattern: "/api/public/organization/{id}",
        openApiPath: "/api/public/organization-api-docs",
        swaggerPath: "/swagger-organization.html",
      },
      {
        id: "issuer",
        configured: issuerOrigin,
        listPath: "/api/public/issuer",
        detailPathPattern: "/api/public/issuer/{id}",
        openApiPath: "/api/public/issuer-api-docs",
        swaggerPath: "/swagger-issuer.html",
      },
      {
        id: "wallet",
        configured: walletOrigin,
        listPath: "/api/public/wallet",
        detailPathPattern: "/api/public/wallet/{orgId}/{walletId}",
        openApiPath: "/api/public/wallet-api-docs",
        swaggerPath: "/swagger-wallet.html",
      },
    ],
  });
}
