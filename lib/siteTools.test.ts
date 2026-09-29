/**
 * Unit checks for model-directed FIDES website browsing.
 * Run: node --experimental-strip-types --test lib/siteTools.test.ts
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ToolResult, ToolServer } from "./catalogClient";
import {
  registerSiteTools,
  resetSiteContentCache,
} from "./siteTools";

type Handler = (
  args: Record<string, unknown>,
) => ToolResult | Promise<ToolResult>;

const originalFetch = globalThis.fetch;
const originalOrigin = process.env.FIDES_SITE_ORIGIN;
const originalDateNow = Date.now;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  if (originalOrigin === undefined) delete process.env.FIDES_SITE_ORIGIN;
  else process.env.FIDES_SITE_ORIGIN = originalOrigin;
  resetSiteContentCache();
});

function toolHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server: ToolServer = {
    tool: (name, _description, _schema, _annotations, handler) => {
      handlers.set(name, handler);
    },
  };
  registerSiteTools(server);
  return handlers;
}

function parseResult(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function mockWordPress(
  pageBody = `${"A".repeat(800)} Winner: Credenco Business Wallet`,
): string[] {
  const requested: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const items = url.includes("/pages?")
      ? [
          {
            id: 42,
            slug: "fides-community-awards",
            title: { rendered: "FIDES Community Awards" },
            content: {
              rendered:
                `<h1>FIDES Community Awards</h1>` +
                `<h2>The 2026 Winners</h2><p>${pageBody}</p>`,
            },
            link: "https://fides.community/awards/fides-community-awards/",
            modified: "2026-09-28T10:00:00",
          },
        ]
      : [
          {
            id: 7,
            slug: "event-report",
            title: { rendered: "Event report" },
            content: { rendered: "<h1>Event report</h1><p>Report body</p>" },
            link: "https://fides.community/event-report/",
            modified: "2026-09-27T10:00:00",
          },
        ];
    return new Response(JSON.stringify(items), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-wp-totalpages": "1",
      },
    });
  };

  return requested;
}

describe("site content tools", () => {
  it("lists all documents without asking WordPress to rank a query", async () => {
    const requested = mockWordPress();
    const list = toolHandlers().get("list_site_content");
    assert.ok(list);

    const result = await list({});
    const body = parseResult(result);
    const documents = body.documents as Record<string, unknown>[];

    assert.equal(documents.length, 2);
    assert.deepEqual(documents[1]!.headings, [
      "FIDES Community Awards",
      "The 2026 Winners",
    ]);
    assert.equal(
      documents[1]!.documentUrl,
      "https://fides.community/awards/fides-community-awards/",
    );
    assert.equal(documents[1]!.headingCount, 2);
    assert.equal("id" in documents[1]!, false);
    assert.equal("kind" in documents[1]!, false);
    assert.equal("url" in documents[1]!, false);
    assert.ok(requested.every((url) => !url.includes("search=")));
  });

  it("reads the complete page text by slug without a 700-character cutoff", async () => {
    mockWordPress();
    const read = toolHandlers().get("read_site_page");
    assert.ok(read);

    const result = await read({ slug: "fides-community-awards" });
    const body = parseResult(result);

    assert.equal(result.isError, undefined);
    assert.equal(body.title, "FIDES Community Awards");
    assert.equal(body.url, "https://fides.community/awards/fides-community-awards/");
    assert.equal(body.untrustedContent, true);
    assert.equal(body.hasMore, false);
    assert.match(String(body.text), /Winner: Credenco Business Wallet/);
    assert.ok(String(body.text).length > 700);
  });

  it("caps index headings while preserving their total count", async () => {
    const extraHeadings = Array.from(
      { length: 30 },
      (_value, index) => `<h2>Section ${index + 1}</h2>`,
    ).join("");
    mockWordPress(extraHeadings);
    const list = toolHandlers().get("list_site_content");
    assert.ok(list);

    const body = parseResult(await list({}));
    const documents = body.documents as Record<string, unknown>[];
    const award = documents.find(
      (document) => document.slug === "fides-community-awards",
    );

    assert.ok(award);
    assert.equal((award.headings as string[]).length, 24);
    assert.equal(award.headingCount, 32);
  });

  it("chunks very long pages without making later content inaccessible", async () => {
    const longBody = `${"A".repeat(31_000)}END`;
    mockWordPress(longBody);
    const read = toolHandlers().get("read_site_page");
    assert.ok(read);

    const first = parseResult(
      await read({ slug: "fides-community-awards" }),
    );
    assert.equal(String(first.text).length, 30_000);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextOffset, 30_000);

    const second = parseResult(
      await read({
        slug: "fides-community-awards",
        offset: first.nextOffset,
      }),
    );
    assert.equal(second.contentStart, 30_000);
    assert.equal(second.hasMore, false);
    assert.match(String(second.text), /END$/);
  });

  it("reads an exact FIDES URL and rejects external URLs", async () => {
    mockWordPress();
    const read = toolHandlers().get("read_site_page");
    assert.ok(read);

    const accepted = await read({
      url: "https://fides.community/awards/fides-community-awards/?ignored=1#top",
    });
    assert.equal(accepted.isError, undefined);

    const rejected = await read({
      url: "https://example.com/awards/fides-community-awards/",
    });
    assert.equal(rejected.isError, true);
    assert.match(
      String(parseResult(rejected).error),
      /Only URLs on the configured FIDES site/,
    );
  });

  it("serves the last cache briefly when WordPress refresh fails", async () => {
    mockWordPress();
    const list = toolHandlers().get("list_site_content");
    const read = toolHandlers().get("read_site_page");
    assert.ok(list);
    assert.ok(read);

    const now = originalDateNow();
    Date.now = () => now;
    const initial = await list({});
    assert.equal(initial.isError, undefined);

    Date.now = () => now + 31 * 60 * 1000;
    globalThis.fetch = async () =>
      new Response("Unavailable", { status: 503 });

    const stale = await list({});
    assert.equal(stale.isError, undefined);
    assert.equal(
      (parseResult(stale).documents as unknown[]).length,
      2,
    );

    const cachedPage = await read({ slug: "fides-community-awards" });
    assert.equal(cachedPage.isError, undefined);
    assert.match(
      String(parseResult(cachedPage).text),
      /Credenco Business Wallet/,
    );
  });
});
