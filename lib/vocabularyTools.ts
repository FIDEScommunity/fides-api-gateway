/**
 * FIDES vocabulary (glossary) MCP tool.
 *
 * The catalogs share a single vocabulary file that defines the terminology used
 * in catalog items and in the filter "(i)" tooltips (e.g. credential formats
 * like SD-JWT-VC, interaction modes like proximity/remote, interop profiles,
 * issuance/presentation protocols). The WordPress plugins already consume it
 * client-side; this tool exposes the same definitions to MCP clients so the
 * assistant can answer conceptual questions ("what is the proximity flow?",
 * "which credential formats exist?") from the curated FIDES source rather than
 * the model's own training data.
 *
 * Source of truth: FIDEScommunity/fides-interop-profiles
 * `data/glossary-aggregated.json` — the same build artifact that powers the
 * public FIDES glossary page. Each term carries a stable `id` (slug) so we can
 * deep-link the assistant's citations straight to the glossary entry at
 * `<glossary page>?term=<id>`. Overridable via FIDES_GLOSSARY_URL (data) and
 * FIDES_GLOSSARY_PAGE_URL (deep-link base).
 */

import { z } from "zod";
import {
  errorContent,
  jsonContent,
  readOnlyTool,
  type ToolServer,
} from "./catalogClient";

const DEFAULT_GLOSSARY_URL =
  "https://raw.githubusercontent.com/FIDEScommunity/fides-interop-profiles/main/data/glossary-aggregated.json";

/** Public glossary page; each term resolves to `<base>?term=<id>`. */
const DEFAULT_GLOSSARY_PAGE = "https://fides.community/community-tools/glossary/";

/** Cache TTL: the vocabulary changes rarely, so an hour keeps GitHub load low. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface GlossaryTerm {
  /** Stable slug used in the glossary deep link (`?term=<id>`). */
  id: string;
  /** Canonical vocabulary key (may differ from the display name). */
  key?: string;
  /** Human-readable display name. */
  name: string;
  description?: string;
  /** External specification reference (not a FIDES citation). */
  url?: string;
  /** Synonyms / alternative spellings that resolve to this term. */
  aliases?: string[];
}

interface Glossary {
  version?: string;
  terms: GlossaryTerm[];
}

interface CacheEntry {
  data: Glossary;
  expires: number;
}

// Module-level cache, shared within a warm serverless instance.
let cache: CacheEntry | null = null;

function glossaryUrl(): string {
  const v = process.env.FIDES_GLOSSARY_URL;
  return v && /^https?:\/\//i.test(v) ? v.trim() : DEFAULT_GLOSSARY_URL;
}

function glossaryPageBase(): string {
  const v = process.env.FIDES_GLOSSARY_PAGE_URL;
  const base = v && /^https?:\/\//i.test(v) ? v.trim() : DEFAULT_GLOSSARY_PAGE;
  return base.endsWith("/") ? base : `${base}/`;
}

/** Canonical FIDES glossary deep link for a term (the citable source). */
function detailUrlFor(term: GlossaryTerm): string {
  return `${glossaryPageBase()}?term=${encodeURIComponent(term.id)}`;
}

function normalizeGlossary(raw: unknown): Glossary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.terms) ? obj.terms : null;
  if (!list) return null;

  const terms: GlossaryTerm[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const t = entry as Record<string, unknown>;
    const id = typeof t.id === "string" ? t.id.trim() : "";
    const name =
      typeof t.name === "string" && t.name.trim()
        ? t.name.trim()
        : typeof t.key === "string"
          ? t.key.trim()
          : "";
    if (!id || !name) continue;
    terms.push({
      id,
      key: typeof t.key === "string" ? t.key.trim() : undefined,
      name,
      description:
        typeof t.description === "string" ? t.description : undefined,
      url: typeof t.url === "string" && t.url.trim() ? t.url.trim() : undefined,
      aliases: Array.isArray(t.aliases)
        ? t.aliases
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter(Boolean)
        : undefined,
    });
  }
  return {
    version: typeof obj.version === "string" ? obj.version : undefined,
    terms,
  };
}

/** Fetch + cache the glossary. Returns stale cache on fetch failure. */
async function loadGlossary(): Promise<Glossary | null> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.data;

  try {
    const res = await fetch(glossaryUrl(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return cache?.data ?? null;
    }
    const parsed = normalizeGlossary(await res.json());
    if (!parsed) {
      return cache?.data ?? null;
    }
    cache = { data: parsed, expires: now + CACHE_TTL_MS };
    return parsed;
  } catch {
    // Network error: serve stale cache if we have it, otherwise signal failure.
    return cache?.data ?? null;
  }
}

/**
 * Resolve a requested term against the glossary (case-insensitive). Matching
 * considers each term's display name, canonical key AND its `aliases`, so
 * synonyms resolve to the same definition. Exact matches win over substring
 * matches.
 */
function matchTerm(
  glossary: Glossary,
  requested: string,
): { match?: GlossaryTerm; suggestions: string[] } {
  const needle = requested.trim().toLowerCase();
  if (!needle) return { suggestions: [] };

  // Every searchable name (display name + key + aliases) mapped to its term.
  const candidates = glossary.terms.flatMap((term) => {
    const names = [term.name, ...(term.aliases ?? [])];
    if (term.key && term.key !== term.name) names.push(term.key);
    return names.map((name) => ({ term, name }));
  });

  // De-duplicate a list of candidate hits by term id, preserving order.
  const uniqueTerms = (hits: { term: GlossaryTerm }[]): GlossaryTerm[] => {
    const seen = new Set<string>();
    const out: GlossaryTerm[] = [];
    for (const h of hits) {
      if (!seen.has(h.term.id)) {
        seen.add(h.term.id);
        out.push(h.term);
      }
    }
    return out;
  };

  // 1) exact match (case-insensitive) on a name, key or alias.
  const exact = candidates.find((c) => c.name.toLowerCase() === needle);
  if (exact) {
    return { match: exact.term, suggestions: [] };
  }

  // 2) substring match; first as the answer, the rest as suggestions.
  const contains = uniqueTerms(
    candidates.filter((c) => c.name.toLowerCase().includes(needle)),
  );
  if (contains.length > 0) {
    const [first, ...rest] = contains;
    return {
      match: first,
      suggestions: rest.slice(0, 5).map((t) => t.name),
    };
  }

  return { suggestions: [] };
}

/**
 * Shape a glossary term as a citable definition. The `detailUrl` (FIDES
 * glossary deep link) is what the assistant's source-card layer picks up; the
 * `name`/`type` make that card readable. `specUrl` is the underlying external
 * specification — kept for the model to mention inline, but intentionally NOT a
 * separate citation field.
 */
function toDefinition(term: GlossaryTerm): Record<string, unknown> {
  return {
    term: term.name,
    name: term.name,
    type: "glossary",
    ...(term.description ? { description: term.description } : {}),
    detailUrl: detailUrlFor(term),
    ...(term.url ? { specUrl: term.url } : {}),
    ...(term.aliases && term.aliases.length ? { aliases: term.aliases } : {}),
  };
}

interface ExplainArgs {
  terms?: string[];
}

const explainSchema: Record<string, z.ZodTypeAny> = {
  terms: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of specific terms to define (case-insensitive), e.g. " +
        "['proximity', 'SD-JWT-VC', 'OpenID4VP']. Omit to return the full " +
        "FIDES glossary (useful for questions like 'which credential formats " +
        "exist?').",
    ),
};

export function registerVocabularyTools(server: ToolServer): void {
  server.tool(
    "explain_terms",
    "Look up official FIDES glossary definitions for the terminology used " +
      "across the catalogs and filters (credential formats such as SD-JWT-VC " +
      "and mDL/mDoc, interaction modes such as proximity and remote, " +
      "interoperability profiles, issuance/presentation protocols, DID " +
      "methods, key storage, etc.). Call with no arguments to retrieve the " +
      "complete glossary, or pass specific `terms` to define just those. Each " +
      "definition includes a `detailUrl` to its entry on the FIDES glossary " +
      "page — cite that as the source. Use this for conceptual questions like " +
      "'what is the proximity flow?' or 'which credential formats are there?'.",
    explainSchema,
    readOnlyTool("Explain FIDES terms"),
    async (rawArgs) => {
      const args = rawArgs as unknown as ExplainArgs;
      const glossary = await loadGlossary();
      if (!glossary) {
        return errorContent({
          error: "Glossary is temporarily unavailable",
          source: glossaryUrl(),
        });
      }

      const requested = Array.isArray(args.terms)
        ? args.terms.filter((t) => typeof t === "string" && t.trim())
        : [];

      // No specific terms requested -> return the full glossary. We omit the
      // per-term `detailUrl` here so a "list everything" question does not
      // flood the answer with hundreds of source cards; specific lookups below
      // still carry the citable deep link.
      if (requested.length === 0) {
        const all = glossary.terms.map((term) => ({
          term: term.name,
          ...(term.description ? { description: term.description } : {}),
          glossaryUrl: detailUrlFor(term),
          ...(term.url ? { specUrl: term.url } : {}),
          ...(term.aliases && term.aliases.length
            ? { aliases: term.aliases }
            : {}),
        }));
        return jsonContent({
          version: glossary.version,
          count: all.length,
          glossaryPage: glossaryPageBase(),
          terms: all,
        });
      }

      const definitions: Record<string, unknown>[] = [];
      const unknown: { requested: string; suggestions: string[] }[] = [];
      for (const req of requested) {
        const { match, suggestions } = matchTerm(glossary, req);
        if (match) {
          definitions.push(toDefinition(match));
        } else {
          unknown.push({ requested: req, suggestions });
        }
      }

      return jsonContent({
        version: glossary.version,
        definitions,
        ...(unknown.length > 0 ? { unknown } : {}),
      });
    },
  );
}
