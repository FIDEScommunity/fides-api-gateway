import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../lib/proxyUpstream";
import {
  GATEWAY_CATALOG_ROUTES,
  isCatalogConfigured,
} from "../lib/gatewayCatalogs";

/** Profile URI from RFC 9727 */
const RFC9727_PROFILE = "https://www.rfc-editor.org/info/rfc9727";

function getRequestOrigin(req: VercelRequest): string {
  const host = req.headers.host ?? "localhost";
  const raw =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"]
      : null) ?? "https";
  const proto = raw.split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

function catalogDocumentPath(origin: string): string {
  return `${origin}/.well-known/api-catalog`;
}

/**
 * RFC 9727 api-catalog: machine-readable API discovery (`application/linkset+json`).
 * Served at `/.well-known/api-catalog` via `vercel.json` rewrite to this handler.
 *
 * Catalog entries are driven by `lib/gatewayCatalogs.ts` — do not duplicate paths here.
 * Maintenance: README.md → “Maintaining discovery (`lib/gatewayCatalogs.ts`)”.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const origin = getRequestOrigin(req);
  const catalogUrl = catalogDocumentPath(origin);
  const linkSelf = `<${catalogUrl}>; rel="api-catalog"`;

  if (req.method === "HEAD") {
    res.setHeader("Link", linkSelf);
    res.setHeader(
      "Content-Type",
      `application/linkset+json; profile="${RFC9727_PROFILE}"`,
    );
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    res.status(405).json({
      message: "Method not allowed",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const items: { href: string }[] = [];
  for (const route of GATEWAY_CATALOG_ROUTES) {
    if (!isCatalogConfigured(route)) continue;
    items.push({ href: `${origin}${route.listPath}` });
  }

  const body = {
    linkset: [
      {
        anchor: catalogUrl,
        item: items,
      },
    ],
  };

  res.setHeader("Link", linkSelf);
  res.setHeader(
    "Content-Type",
    `application/linkset+json; profile="${RFC9727_PROFILE}"`,
  );
  res.status(200).send(JSON.stringify(body));
}
