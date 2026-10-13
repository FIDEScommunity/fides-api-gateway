import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxyToBackend } from "./proxyUpstream";

const CREDENTIAL_ORIGIN_ENV = "FIDES_CREDENTIAL_CATALOG_ORIGIN";

function splitQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? "" : url.slice(i);
}

function gatewayOrigin(req: VercelRequest): string {
  const host = req.headers.host ?? "api.fides.community";
  const raw =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"]
      : null) ?? "https";
  const proto = raw.split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

/**
 * Proxy a TS11 path to the credential catalog upstream and rewrite
 * `x-jku-url` so clients resolve keys via this gateway hostname.
 */
export async function proxyTs11Path(
  req: VercelRequest,
  res: VercelResponse,
  upstreamPath: string,
): Promise<void> {
  const path = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  const query = splitQuery(req.url || "");
  const jku = `${gatewayOrigin(req)}/api/jwks`;

  await proxyToBackend(req, res, {
    origin: process.env[CREDENTIAL_ORIGIN_ENV],
    originEnvName: CREDENTIAL_ORIGIN_ENV,
    upstreamPathAndQuery: `${path}${query}`,
    rewriteResponseHeader(name, value) {
      if (name.toLowerCase() === "x-jku-url") {
        return jku;
      }
      return value;
    },
  });
}
