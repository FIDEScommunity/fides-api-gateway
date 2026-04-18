/**
 * Shared catalog route metadata for the FIDES API gateway (discovery + RFC 9727).
 */

export type GatewayCatalogId =
  | "credential"
  | "organization"
  | "issuer"
  | "wallet";

export interface GatewayCatalogRoute {
  id: GatewayCatalogId;
  /** Env var holding the upstream origin (e.g. FIDES_CREDENTIAL_CATALOG_ORIGIN). */
  originEnv: string;
  listPath: string;
  detailPathPattern: string;
  openApiPath: string;
  swaggerPath: string;
  legacyOpenApiPath?: string;
  legacySwaggerPath?: string;
}

export const GATEWAY_CATALOG_ROUTES: readonly GatewayCatalogRoute[] = [
  {
    id: "credential",
    originEnv: "FIDES_CREDENTIAL_CATALOG_ORIGIN",
    listPath: "/api/public/credentialtype",
    detailPathPattern: "/api/public/credentialtype/{id}",
    openApiPath: "/api/public/credential-api-docs",
    swaggerPath: "/swagger-credentialtype.html",
    legacyOpenApiPath: "/api/public/api-docs",
    legacySwaggerPath: "/swagger.html",
  },
  {
    id: "organization",
    originEnv: "FIDES_ORGANIZATION_CATALOG_ORIGIN",
    listPath: "/api/public/organization",
    detailPathPattern: "/api/public/organization/{id}",
    openApiPath: "/api/public/organization-api-docs",
    swaggerPath: "/swagger-organization.html",
  },
  {
    id: "issuer",
    originEnv: "FIDES_ISSUER_CATALOG_ORIGIN",
    listPath: "/api/public/issuer",
    detailPathPattern: "/api/public/issuer/{id}",
    openApiPath: "/api/public/issuer-api-docs",
    swaggerPath: "/swagger-issuer.html",
  },
  {
    id: "wallet",
    originEnv: "FIDES_WALLET_CATALOG_ORIGIN",
    listPath: "/api/public/wallet",
    detailPathPattern: "/api/public/wallet/{orgId}/{walletId}",
    openApiPath: "/api/public/wallet-api-docs",
    swaggerPath: "/swagger-wallet.html",
  },
] as const;

export function isCatalogConfigured(route: GatewayCatalogRoute): boolean {
  const v = process.env[route.originEnv];
  return !!v && /^https?:\/\//i.test(String(v));
}
