// Links a recipe's ingredient line ("2 cups chopped tomatoes", "1 su bardağı
// unu") to a catalog entry by its name or aliases (Phase 5). No LLM: whole
// words, and only the key's last word may carry an ending — an English plural
// ("tomatoes") or a Turkish suffix ("ıspanağı", "soğanları") — because both
// languages put it on the head noun. `# ` section headings are never linked.
import { normalizeName } from "./tagging.js";

export type CatalogKeys = { id: string; normalizedName: string; aliases: string[] };

// What buildMatcher needs from the ingredient table.
export const CATALOG_KEYS_SELECT = { id: true, normalizedName: true, aliases: true } as const;

// Same rule as isHeadingLine in app/src/recipes/recipeForm.ts.
const HEADING_PATTERN = /^#+\s+\S/;

export function isHeadingLine(text: string): boolean {
  return HEADING_PATTERN.test(text.trim());
}

// normalizeName with ı folded into i: normalizeName lower-cases the Turkish
// way, so an English capital I ("OLIVE OIL", "Italian") would otherwise
// become ı. Used on both sides of a comparison (matcher and search).
export function foldText(text: string): string {
  return normalizeName(text).replace(/ı/g, "i");
}

// Words only: digits, "½", commas and hyphens split words ("all-purpose" →
// "all purpose"), so a key matches however the line punctuates it.
function words(text: string): string[] {
  return foldText(text)
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 0);
}

// Endings allowed on the key's last word. English: plural s/es. Turkish, each
// part optional and in this order: plural, possessive (salça → salçası),
// case (accusative, dative, locative, ablative, genitive, "with"). Vowel
// harmony isn't checked; the set is small enough that loose is fine.
const ENDING = new RegExp(
  "^(?:e?s|" +
    "(?:lar|ler)?" +
    "(?:s?[ıiuü]|ları|leri)?" +
    "(?:[yn]?[ıiuü]|[yn]?[ae]|n?[dt][ae]n?|y?l[ae]|n?[ıiuü]n)?" +
    ")$",
);

// Turkish softens a final k/p/ç/t before a vowel: ıspanak → ıspanağı,
// havuç → havucu. Short words often don't (turp → turpu), so both count.
const SOFTENED: Record<string, string> = { k: "ğ", p: "b", ç: "c", t: "d" };

function stems(word: string): string[] {
  const soft = SOFTENED[word.at(-1)!];
  return soft ? [word, word.slice(0, -1) + soft] : [word];
}

// Whether `word` is `last`, or `last` plus an allowed ending. The softened
// stem only counts with an ending that starts with a vowel.
function endsLike(word: string, last: string): "exact" | "ending" | null {
  if (word === last) return "exact";
  for (const stem of stems(last)) {
    if (!word.startsWith(stem) || word.length === stem.length) continue;
    const ending = word.slice(stem.length);
    if (stem !== last && !/^[ıiuüae]/.test(ending)) continue;
    if (ENDING.test(ending)) return "ending";
  }
  return null;
}

type Key = { id: string; words: string[] };

type Candidate = { id: string; words: number; exact: boolean; start: number };

// Longest match wins: more words, then an exact last word over one with an
// ending (so "hamsi" isn't read as "ham" + "sı", nor "nane yaprakları" as
// vine leaves), then the later one, since both languages end on the head
// noun ("raspberry jam", "3 cloves garlic", "salt and pepper").
function better(a: Candidate, b: Candidate): boolean {
  if (a.words !== b.words) return a.words > b.words;
  if (a.exact !== b.exact) return a.exact;
  return a.start > b.start;
}

export function buildMatcher(catalog: CatalogKeys[]) {
  const keys: Key[] = catalog.flatMap((entry) =>
    [entry.normalizedName, ...entry.aliases].map((key) => ({ id: entry.id, words: words(key) })),
  );

  // The catalog entry id for a line, or null when nothing matches.
  return function match(text: string): string | null {
    if (isHeadingLine(text)) return null;
    const line = words(text);
    let best: Candidate | null = null;

    for (const key of keys) {
      const count = key.words.length;
      const head = key.words.slice(0, -1);
      for (let start = 0; start + count <= line.length; start++) {
        if (!head.every((word, index) => line[start + index] === word)) continue;
        const last = endsLike(line[start + count - 1], key.words[count - 1]);
        if (!last) continue;
        const candidate = { id: key.id, words: count, exact: last === "exact", start };
        if (!best || better(candidate, best)) best = candidate;
      }
    }

    return best?.id ?? null;
  };
}

export type Matcher = ReturnType<typeof buildMatcher>;
