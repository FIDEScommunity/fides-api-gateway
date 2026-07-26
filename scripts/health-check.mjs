#!/usr/bin/env node
/**
 * End-to-end health check for the public MCP server.
 *
 * Catches the two failure modes that silently broke the ChatGPT App review:
 * a catalog upstream going down (tools answer with an error) and a tool
 * degrading to empty results (the WordPress firewall answering 403), neither of
 * which surfaces anywhere until someone calls the tool by hand.
 *
 * It also guards the privacy commitment made in the published policy: no
 * internal crawl/provenance metadata may appear in any tool response.
 *
 * Usage:
 *   node scripts/health-check.mjs                 # checks production
 *   GATEWAY_URL=http://localhost:3000 node scripts/health-check.mjs
 *
 * Exits 0 when every check passes, 1 otherwise. Writes health-report.json and
 * health-summary.md next to the working directory for CI artifacts.
 */

import fs from "node:fs";

const GATEWAY_URL = (process.env.GATEWAY_URL ?? "https://api.fides.community")
  .trim()
  .replace(/\/+$/, "");
const MCP_ENDPOINT = `${GATEWAY_URL}/api/mcp`;
const REQUEST_TIMEOUT_MS = 20_000;

/** Every tool the app declares in its ChatGPT App submission. */
const EXPECTED_TOOLS = [
  "search",
  "fetch",
  "search_wallets",
  "get_wallet",
  "search_credential_types",
  "get_credential_type",
  "search_organizations",
  "get_organization",
  "search_issuers",
  "get_issuer",
  "search_relying_parties",
  "get_relying_party",
  "search_use_cases",
  "get_use_case",
  "explain_terms",
  "search_site_content",
];

/**
 * Internal metadata that must never reach a client. Kept in sync with
 * `sanitizeRecord()` in lib/catalogClient.ts — if that list grows, grow this one
 * so the check keeps proving the policy.
 */
const FORBIDDEN_FIELDS = [
  "fetchedAt",
  "firstSeenAt",
  "lastSeenAt",
  "crawledAt",
  "lastCrawled",
  "lastCrawledAt",
  "ingestedAt",
  "source",
  "sourceUrl",
  "catalogUrl",
];

/**
 * One case per tool, using arguments known to match real catalog data. Cases
 * flagged `submissionTestCase` mirror the prompts OpenAI reviewers replay, so a
 * failure here predicts a rejected submission.
 */
const CHECKS = [
  {
    tool: "search_wallets",
    args: { vcFormat: "sd_jwt_vc", type: "personal", platforms: "iOS,Android", size: 3 },
    listKey: "wallets",
    submissionTestCase: true,
  },
  {
    tool: "get_wallet",
    args: { orgId: "org:animo", walletId: "paradym-wallet" },
    requireFields: ["name", "vcFormat"],
    submissionTestCase: true,
  },
  {
    tool: "search_organizations",
    args: { trustService: "QEAA", size: 3 },
    listKey: "organizations",
    submissionTestCase: true,
  },
  {
    tool: "search_issuers",
    args: { search: "PID", vcFormat: "sd_jwt_vc", size: 3 },
    listKey: "issuers",
    submissionTestCase: true,
  },
  {
    tool: "explain_terms",
    args: { terms: ["proximity"] },
    listKey: "definitions",
    submissionTestCase: true,
  },
  {
    tool: "search_site_content",
    args: { query: "business wallets" },
    listKey: "results",
    submissionTestCase: true,
  },
  { tool: "search", args: { query: "animo" }, listKey: "results" },
  {
    tool: "fetch",
    args: { id: "rp:air-new-zealand" },
    requireFields: ["title", "text", "url"],
  },
  { tool: "search_credential_types", args: { size: 3 }, listKey: "credentialTypes" },
  {
    tool: "get_credential_type",
    args: { id: "cred:uidai:aadhaar-mdoc:mdoc" },
    requireFields: ["id"],
  },
  { tool: "get_organization", args: { id: "org:animo" }, requireFields: ["name"] },
  {
    tool: "get_issuer",
    args: { id: "issuer:iata:air-new-zealand:production" },
    requireFields: ["displayName"],
  },
  { tool: "search_relying_parties", args: { size: 3 }, listKey: "relyingParties" },
  {
    tool: "get_relying_party",
    args: { id: "air-new-zealand" },
    requireFields: ["name"],
  },
  { tool: "search_use_cases", args: { size: 3 }, listKey: "useCases" },
  {
    tool: "get_use_case",
    args: { id: "age-verification-online-purchase" },
    requireFields: ["title"],
  },
];

let nextRequestId = 1;

/** Call an MCP method and return the JSON-RPC result, parsing the SSE framing. */
async function callMcp(method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextRequestId++,
        method,
        params,
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
    }
    // The transport replies with server-sent events; the payload is the last
    // `data:` line. Plain JSON is accepted too so the check keeps working if the
    // transport changes.
    const dataLine = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .pop();
    const envelope = JSON.parse(dataLine ?? raw);
    if (envelope.error) {
      throw new Error(`JSON-RPC error: ${JSON.stringify(envelope.error)}`);
    }
    return envelope.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Call a tool and parse the JSON document it returns as text content. */
async function callTool(name, args) {
  const result = await callMcp("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("tool returned no text content");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`tool returned non-JSON content: ${text.slice(0, 160)}`);
  }
  return { payload, isError: result.isError === true };
}

/** Collect forbidden keys anywhere in a nested structure. */
function findForbiddenFields(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) findForbiddenFields(entry, found);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.includes(key)) found.add(key);
      findForbiddenFields(entry, found);
    }
  }
  return found;
}

const results = [];

function record(name, ok, detail, meta = {}) {
  results.push({ name, ok, detail, ...meta });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function checkToolInventory() {
  let tools;
  try {
    ({ tools } = await callMcp("tools/list", {}));
  } catch (e) {
    record("tools/list reachable", false, e.message);
    return null;
  }
  const names = tools.map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  const unexpected = names.filter((n) => !EXPECTED_TOOLS.includes(n));
  record(
    "tool inventory matches submission",
    missing.length === 0 && unexpected.length === 0,
    missing.length || unexpected.length
      ? `missing: [${missing}] unexpected: [${unexpected}]`
      : `${names.length} tools`,
  );

  // The submission declares every tool as a safe read; a drifted annotation is
  // a documented rejection reason.
  const wrong = tools.filter((t) => {
    const a = t.annotations ?? {};
    return (
      a.readOnlyHint !== true ||
      a.destructiveHint !== false ||
      a.openWorldHint !== true
    );
  });
  record(
    "annotations are read-only, non-destructive, open-world",
    wrong.length === 0,
    wrong.length ? `drifted: ${wrong.map((t) => t.name).join(", ")}` : "all 16 correct",
  );
  return tools;
}

async function runCheck(check) {
  const label = `${check.tool}${check.submissionTestCase ? " (submission test case)" : ""}`;
  let payload;
  let isError;
  try {
    ({ payload, isError } = await callTool(check.tool, check.args));
  } catch (e) {
    record(label, false, e.message, { tool: check.tool });
    return;
  }

  if (isError || payload?.error) {
    const detail = payload?.error
      ? `tool error: ${JSON.stringify(payload.error).slice(0, 160)}`
      : "tool reported isError";
    record(label, false, detail, { tool: check.tool });
    return;
  }

  if (check.listKey) {
    const list = payload?.[check.listKey];
    if (!Array.isArray(list)) {
      record(label, false, `missing '${check.listKey}' array`, { tool: check.tool });
      return;
    }
    if (list.length === 0) {
      // The degradation that made site search useless without any error.
      record(label, false, `'${check.listKey}' is empty`, { tool: check.tool });
      return;
    }
    record(label, true, `${list.length} result(s)`, { tool: check.tool });
  } else {
    const missing = (check.requireFields ?? []).filter(
      (f) => payload?.[f] === undefined || payload?.[f] === null,
    );
    if (missing.length) {
      record(label, false, `missing field(s): ${missing.join(", ")}`, {
        tool: check.tool,
      });
      return;
    }
    record(label, true, "record returned", { tool: check.tool });
  }

  const leaked = findForbiddenFields(payload);
  record(
    `${check.tool} returns no internal metadata`,
    leaked.size === 0,
    leaked.size ? `leaked: ${[...leaked].join(", ")}` : "clean",
    { tool: check.tool },
  );
}

function writeReport() {
  const failed = results.filter((r) => !r.ok);
  const report = {
    checkedAt: new Date().toISOString(),
    gateway: GATEWAY_URL,
    total: results.length,
    failedCount: failed.length,
    results,
  };
  fs.writeFileSync("health-report.json", `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    `- Endpoint: \`${MCP_ENDPOINT}\``,
    `- Checks: ${results.length}`,
    `- Failed: ${failed.length}`,
    "",
  ];
  if (failed.length) {
    lines.push("**Failing checks**", "");
    for (const f of failed) lines.push(`- \`${f.name}\` — ${f.detail}`);
  } else {
    lines.push("All checks passed.");
  }
  fs.writeFileSync("health-summary.md", `${lines.join("\n")}\n`);
  return failed;
}

async function main() {
  console.log(`Checking ${MCP_ENDPOINT}\n`);
  await checkToolInventory();
  // Sequential on purpose: a burst of parallel calls can trip the gateway rate
  // limiter and produce failures that say nothing about catalog health.
  for (const check of CHECKS) {
    await runCheck(check);
  }
  const failed = writeReport();
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`,
  );
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`Health check crashed: ${e?.stack ?? e}`);
  process.exit(1);
});
