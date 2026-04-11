import type { VercelRequest, VercelResponse } from "@vercel/node";

const HOP_BY_HOP = new Set([
  "connection",
  "transfer-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "upgrade",
]);

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function applyCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization",
  );
}

function splitPathAndQuery(url: string): { path: string; query: string } {
  const i = url.indexOf("?");
  if (i === -1) {
    return { path: url, query: "" };
  }
  return { path: url.slice(0, i), query: url.slice(i) };
}

/**
 * Reverse-proxy a GET (or OPTIONS) to an upstream catalog deployment.
 */
export async function proxyToBackend(
  req: VercelRequest,
  res: VercelResponse,
  options: {
    origin: string | undefined;
    originEnvName: string;
    /** Path + query as seen by the upstream, e.g. "/api/public/organization?page=0" */
    upstreamPathAndQuery: string;
  },
): Promise<void> {
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

  const { origin, originEnvName, upstreamPathAndQuery } = options;
  if (!origin || !/^https?:\/\//i.test(origin)) {
    res.status(503).json({
      message: "Upstream is not configured for this route",
      missingEnv: originEnvName,
      hint: "Set the env var to the catalog *.vercel.app URL (not the public gateway hostname).",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const pq = upstreamPathAndQuery.startsWith("/")
    ? upstreamPathAndQuery
    : `/${upstreamPathAndQuery}`;
  const target = `${stripTrailingSlash(origin)}${pq}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: {
        ...(typeof req.headers.accept === "string" && req.headers.accept
          ? { Accept: req.headers.accept }
          : {}),
      },
      redirect: "manual",
    });
  } catch (e) {
    console.error("Gateway proxy fetch failed:", target, e);
    res.status(502).json({
      message: "Bad gateway: failed to reach upstream",
      target,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (HOP_BY_HOP.has(lk)) {
      return;
    }
    if (lk === "content-encoding") {
      return;
    }
    res.setHeader(key, value);
  });
  applyCors(res);

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
}

/** Proxy using the same path and query string as the incoming request. */
export async function proxySamePath(
  req: VercelRequest,
  res: VercelResponse,
  origin: string | undefined,
  originEnvName: string,
): Promise<void> {
  const raw = req.url || "/";
  const pathAndQuery = raw.startsWith("/") ? raw : `/${raw}`;
  return proxyToBackend(req, res, {
    origin,
    originEnvName,
    upstreamPathAndQuery: pathAndQuery,
  });
}

/**
 * Map gateway path to upstream (e.g. organization OpenAPI lives at /api/public/api-docs on the org project).
 */
export async function proxyWithPathRewrite(
  req: VercelRequest,
  res: VercelResponse,
  origin: string | undefined,
  originEnvName: string,
  upstreamPath: string,
): Promise<void> {
  const { query } = splitPathAndQuery(req.url || "");
  const path = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  return proxyToBackend(req, res, {
    origin,
    originEnvName,
    upstreamPathAndQuery: `${path}${query}`,
  });
}
