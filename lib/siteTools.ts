/**
 * WordPress site-content search tool (Option A).
 *
 * Lets the homepage chat answer conceptual / general questions that are NOT in
 * the structured catalogs — e.g. "what is a business wallet", "what is FIDES",
 * the manifesto, use cases, news, events — by searching the public FIDES
 * Community website over the WordPress REST API and returning short, citable
 * page excerpts.
 *
 * Easy kill switch: this tool is only registered when site content is enabled
 * (see `isSiteContentEnabled`). Set `CHAT_SITE_CONTENT_ENABLED=0` in the gateway
 * environment to remove it entirely (the model can then no longer call it and
 * the chat falls back to catalog-only answers).
 */

import { z } from "zod";
import {
  jsonContent,
  readOnlyTool,
  siteOrigin,
  type ToolServer,
} from "./catalogClient";

const PER_TYPE = 4;
const MAX_RESULTS = 6;
const MAX_TEXT = 700;

/** Master switch — defaults ON, disable with CHAT_SITE_CONTENT_ENABLED=0. */
export function isSiteContentEnabled(): boolean {
  const v = (process.env.CHAT_SITE_CONTENT_ENABLED ?? "").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

const searchSchema: Record<string, z.ZodTypeAny> = {
  query: z
    .string()
    .describe(
      "Free-text query about FIDES concepts, definitions, news, events or " +
        "use cases (e.g. 'business wallet', 'what is FIDES', 'manifesto').",
    ),
};

interface SiteResult {
  title: string;
  url: string;
  text: string;
  type: "page";
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&#8217;": "\u2019",
  "&#8216;": "\u2018",
  "&#8220;": "\u201C",
  "&#8221;": "\u201D",
  "&#8211;": "\u2013",
  "&#8230;": "\u2026",
  "&hellip;": "\u2026",
};

function stripHtml(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&nbsp;|&amp;|&lt;|&gt;|&quot;|&#0?39;|&#8217;|&#8216;|&#8220;|&#8221;|&#8211;|&#8230;|&hellip;/gi,
      (m) => ENTITIES[m.toLowerCase()] ?? ENTITIES[m] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trim()}\u2026` : text;
}

interface WpRendered {
  rendered?: string;
}
interface WpItem {
  title?: WpRendered;
  excerpt?: WpRendered;
  content?: WpRendered;
  link?: string;
}

async function searchWp(
  kind: "pages" | "posts",
  query: string,
): Promise<SiteResult[]> {
  const url =
    `${siteOrigin()}/wp-json/wp/v2/${kind}` +
    `?search=${encodeURIComponent(query)}` +
    `&per_page=${PER_TYPE}` +
    `&_fields=${encodeURIComponent("title,excerpt,content,link")}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    const out: SiteResult[] = [];
    for (const raw of data as WpItem[]) {
      const link = typeof raw.link === "string" ? raw.link : "";
      if (!link) continue;
      const title = stripHtml(raw.title?.rendered ?? "") || link;
      const excerpt = stripHtml(raw.excerpt?.rendered ?? "");
      const body = stripHtml(raw.content?.rendered ?? "");
      // Prefer the page body: it holds the real facts (dates, details). WP
      // excerpts are often auto-generated or stale, so only use them as a
      // fallback when the body is too thin to be useful.
      const text = body.length >= 60 ? body : excerpt || body;
      out.push({ title, url: link, text, type: "page" });
    }
    return out;
  } catch {
    return [];
  }
}

export function registerSiteTools(server: ToolServer): void {
  server.tool(
    "search_site_content",
    "Search the FIDES Community website (pages, posts, news, explanatory and " +
      "conceptual content) for general questions the catalogs do NOT answer — " +
      "e.g. definitions like 'what is a business wallet', what FIDES is, the " +
      "manifesto, use cases, events or tracks. Returns matching page titles, a " +
      "text excerpt, and the canonical page URL to cite. Use the catalog tools " +
      "(search / get_*) for concrete wallets, issuers, organizations, " +
      "credential types and relying parties instead.",
    searchSchema,
    readOnlyTool("Search site content"),
    async (rawArgs) => {
      const args = rawArgs as unknown as { query?: string };
      const query = (args.query ?? "").trim();
      if (!query) return jsonContent({ results: [] });
      const [pages, posts] = await Promise.all([
        searchWp("pages", query),
        searchWp("posts", query),
      ]);
      const results = [...pages, ...posts]
        .filter((r) => r.text)
        .slice(0, MAX_RESULTS);
      return jsonContent({ results });
    },
  );
}
