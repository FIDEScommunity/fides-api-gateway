/**
 * Unit checks for chat orchestration helpers.
 * Run: node --experimental-strip-types --test lib/chatAgent.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterCitedSources, type ChatSource } from "./chatAgent";

const sources: ChatSource[] = [
  {
    title: "FIDES Community Awards",
    url: "https://fides.community/awards/fides-community-awards/",
    type: "page",
  },
  {
    title: "Awards",
    url: "https://fides.community/awards/",
    type: "page",
  },
];

describe("filterCitedSources", () => {
  it("removes tool results that the answer does not cite", () => {
    const answer =
      "Bron: [FIDES Community Awards]" +
      "(https://fides.community/awards/fides-community-awards/)";

    assert.deepEqual(filterCitedSources(answer, sources), [sources[0]]);
  });

  it("keeps all sources when the model returned no inline citation", () => {
    assert.deepEqual(filterCitedSources("Credenco won.", sources), sources);
  });
});
