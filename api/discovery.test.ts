import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import apiCatalogHandler from "./well-known-api-catalog";
import aiCatalogHandler from "./well-known-ai-catalog";
import serverCardHandler from "./mcp-server-card";
import { GATEWAY_CATALOG_ROUTES } from "../lib/gatewayCatalogs";

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  ended: boolean;
};

function request(method = "GET"): VercelRequest {
  return {
    method,
    headers: {
      host: "api.fides.community",
      "x-forwarded-proto": "https",
    },
  } as unknown as VercelRequest;
}

function response(): { res: VercelResponse; state: MockResponse } {
  const state: MockResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
  };
  const res = {
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    send(body: unknown) {
      state.body = body;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    end() {
      state.ended = true;
      return this;
    },
  } as unknown as VercelResponse;
  return { res, state };
}

const savedOrigins: Record<string, string | undefined> = {};

before(() => {
  for (const route of GATEWAY_CATALOG_ROUTES) {
    savedOrigins[route.originEnv] = process.env[route.originEnv];
    process.env[route.originEnv] = `https://${route.id}.example`;
  }
});

after(() => {
  for (const [key, value] of Object.entries(savedOrigins)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("agent discovery", () => {
  it("links every configured API to its OpenAPI description", () => {
    const { res, state } = response();
    apiCatalogHandler(request(), res);

    assert.equal(state.statusCode, 200);
    assert.match(
      state.headers["content-type"],
      /^application\/linkset\+json/,
    );
    const body = JSON.parse(String(state.body)) as {
      linkset: Array<Record<string, unknown>>;
    };
    for (const route of GATEWAY_CATALOG_ROUTES) {
      const description = body.linkset.find(
        (entry) =>
          entry.anchor === `https://api.fides.community${route.listPath}`,
      );
      assert.deepEqual(description?.["service-desc"], [
        {
          href: `https://api.fides.community${route.openApiPath}`,
        },
      ]);
    }
  });

  it("publishes an AI Catalog pointing to the server card", () => {
    const { res, state } = response();
    aiCatalogHandler(request(), res);

    assert.equal(state.statusCode, 200);
    assert.equal(
      state.headers["content-type"],
      "application/ai-catalog+json",
    );
    const body = JSON.parse(String(state.body));
    assert.equal(body.specVersion, "1.0");
    assert.equal(
      body.entries[0].url,
      "https://api.fides.community/api/mcp/server-card",
    );
    assert.equal(
      body.entries[0].type,
      "application/mcp-server-card+json",
    );
  });

  it("publishes a server card for the Streamable HTTP endpoint", () => {
    const { res, state } = response();
    serverCardHandler(request(), res);

    assert.equal(state.statusCode, 200);
    assert.equal(
      state.headers["content-type"],
      "application/mcp-server-card+json",
    );
    const body = JSON.parse(String(state.body));
    assert.equal(
      body.$schema,
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    );
    assert.equal(
      body.name,
      "community.fides/fides-ecosystem-explorer",
    );
    assert.deepEqual(body.remotes, [
      {
        type: "streamable-http",
        url: "https://api.fides.community/api/mcp",
      },
    ]);
  });
});
