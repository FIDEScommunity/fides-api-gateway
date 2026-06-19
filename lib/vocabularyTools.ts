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
 * Source of truth: FIDEScommunity/fides-interop-profiles `data/vocabulary.json`
 * (flat `terms` map of key -> { description, url? }). Overridable via
 * FIDES_VOCABULARY_URL; falls back to the raw GitHub URL the plugins use.
 */

import { z } from "zod";
import {
  errorContent,
  jsonContent,
  readOnlyTool,
  type ToolServer,
} from "./catalogClient";

const DEFAULT_VOCABULARY_URL =
  "https://raw.githubusercontent.com/FIDEScommunity/fides-interop-profiles/main/data/vocabulary.json";

/** Cache TTL: the vocabulary changes rarely, so an hour keeps GitHub load low. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface VocabularyTerm {
  description?: string;
  url?: string;
  /** Synonyms / alternative spellings that resolve to this term. */
  aliases?: string[];
}

interface Vocabulary {
  version?: string;
  terms: Record<string, VocabularyTerm>;
}

interface CacheEntry {
  data: Vocabulary;
  expires: number;
}

// Module-level cache, shared within a warm serverless instance.
let cache: CacheEntry | null = null;

function vocabularyUrl(): string {
  const v = process.env.FIDES_VOCABULARY_URL;
  return v && /^https?:\/\//i.test(v) ? v.trim() : DEFAULT_VOCABULARY_URL;
}

function normalizeVocabulary(raw: unknown): Vocabulary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const terms =
    obj.terms && typeof obj.terms === "object"
      ? (obj.terms as Record<string, VocabularyTerm>)
      : null;
  if (!terms) return null;
  return {
    version: typeof obj.version === "string" ? obj.version : undefined,
    terms,
  };
}

/** Fetch + cache the vocabulary. Returns stale cache on fetch failure. */
async function loadVocabulary(): Promise<Vocabulary | null> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.data;

  try {
    const res = await fetch(vocabularyUrl(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return cache?.data ?? null;
    }
    const parsed = normalizeVocabulary(await res.json());
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

interface MatchedTerm {
  term: string;
  description?: string;
  url?: string;
  aliases?: string[];
}

/**
 * Resolve a requested term against the glossary (case-insensitive). Matching
 * considers each term's canonical key AND its `aliases`, so synonyms resolve to
 * the same definition. Exact matches win over substring matches.
 */
function matchTerm(
  vocab: Vocabulary,
  requested: string,
): { match?: MatchedTerm; suggestions: string[] } {
  const needle = requested.trim().toLowerCase();

  // Every searchable name (canonical key + aliases) mapped back to its key.
  const candidates = Object.entries(vocab.terms).flatMap(([key, term]) =>
    [key, ...(term.aliases ?? [])].map((name) => ({ key, name })),
  );

  // De-duplicate a list of candidate hits by their canonical key, in order.
  const uniqueKeys = (hits: { key: string }[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of hits) {
      if (!seen.has(h.key)) {
        seen.add(h.key);
        out.push(h.key);
      }
    }
    return out;
  };

  // 1) exact match (case-insensitive) on a key or alias.
  const exact = candidates.find((c) => c.name.toLowerCase() === needle);
  if (exact) {
    return { match: { term: exact.key, ...vocab.terms[exact.key] }, suggestions: [] };
  }

  // 2) substring match on a key or alias; first as the answer, rest as suggestions.
  const contains = uniqueKeys(
    candidates.filter((c) => c.name.toLowerCase().includes(needle)),
  );
  if (contains.length > 0) {
    const [first, ...rest] = contains;
    return {
      match: { term: first, ...vocab.terms[first] },
      suggestions: rest.slice(0, 5),
    };
  }

  return { suggestions: [] };
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
      "complete glossary, or pass specific `terms` to define just those. Use " +
      "this for conceptual questions like 'what is the proximity flow?' or " +
      "'which credential formats are there?'.",
    explainSchema,
    readOnlyTool("Explain FIDES terms"),
    async (rawArgs) => {
      const args = rawArgs as unknown as ExplainArgs;
      const vocab = await loadVocabulary();
      if (!vocab) {
        return errorContent({
          error: "Vocabulary is temporarily unavailable",
          source: vocabularyUrl(),
        });
      }

      const requested = Array.isArray(args.terms)
        ? args.terms.filter((t) => typeof t === "string" && t.trim())
        : [];

      // No specific terms requested -> return the full glossary.
      if (requested.length === 0) {
        const all: MatchedTerm[] = Object.keys(vocab.terms).map((term) => ({
          term,
          ...vocab.terms[term],
        }));
        return jsonContent({
          version: vocab.version,
          count: all.length,
          terms: all,
        });
      }

      const definitions: MatchedTerm[] = [];
      const unknown: { requested: string; suggestions: string[] }[] = [];
      for (const req of requested) {
        const { match, suggestions } = matchTerm(vocab, req);
        if (match) {
          definitions.push(match);
        } else {
          unknown.push({ requested: req, suggestions });
        }
      }

      return jsonContent({
        version: vocab.version,
        definitions,
        ...(unknown.length > 0 ? { unknown } : {}),
      });
    },
  );
}
