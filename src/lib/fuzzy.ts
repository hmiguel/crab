const isBoundary = (text: string, i: number) =>
  i === 0 || /[\\/\-_. ]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

/**
 * Case-insensitive subsequence match. Returns null on a miss; higher is better.
 * Rewards consecutive runs and word/camelCase starts, penalizes gaps and late starts.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let prev = -1;
  for (const ch of q) {
    const i = t.indexOf(ch, prev + 1);
    if (i < 0) return null;
    score += 1;
    if (isBoundary(text, i)) score += 6;
    if (prev >= 0 && i === prev + 1) score += 7;
    else score -= prev < 0 ? Math.min(i, 10) : Math.min(i - prev - 1, 3);
    prev = i;
  }
  return score;
}

/** Scores content matches below any possible fuzzy name match. */
const CONTENT_SCORE = -1e6;

/** Case-insensitive substring match for queries of 3+ characters: fuzzy matching over long text matches almost anything. */
export function containsScore(query: string, text: string): number | null {
  if (query.length < 3) return null;
  return text.toLowerCase().includes(query.toLowerCase()) ? CONTENT_SCORE : null;
}

/** The line of `text` containing `query`, trimmed to about `width` characters around the match. */
export function snippet(query: string, text: string, width = 80): string {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return "";
  const lineStart = text.lastIndexOf("\n", i) + 1;
  const lineEnd = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
  const line = text.slice(lineStart, lineEnd).trim();
  if (line.length <= width) return line;
  const at = line.toLowerCase().indexOf(query.toLowerCase());
  const from = Math.max(0, Math.min(at - Math.floor((width - query.length) / 2), line.length - width));
  return (from > 0 ? "…" : "") + line.slice(from, from + width) + (from + width < line.length ? "…" : "");
}

export type Ranked<T> = { item: T; viaContent: boolean };

type RankOptions<T> = {
  /** Short fields matched fuzzily (names, URLs, paths). */
  fields: (item: T) => string[];
  label: (item: T) => string;
  /** Long text matched by substring only, ranked below any field match. */
  content?: (item: T) => string;
  limit?: number;
};

/** Items matching `query`, best first (ties: shorter label), at most `limit`. */
export function rankItems<T>(query: string, items: T[], { fields, label, content, limit = 50 }: RankOptions<T>): Ranked<T>[] {
  const scored: Array<Ranked<T> & { score: number }> = [];
  for (const item of items) {
    let best: number | null = null;
    for (const f of fields(item)) {
      const s = fuzzyScore(query, f);
      if (s !== null && (best === null || s > best)) best = s;
    }
    if (best !== null) scored.push({ item, viaContent: false, score: best });
    else if (content) {
      const s = containsScore(query, content(item));
      if (s !== null) scored.push({ item, viaContent: true, score: s });
    }
  }
  // Array.prototype.sort is stable, so equal items keep their input order.
  scored.sort((a, b) => b.score - a.score || label(a.item).length - label(b.item).length);
  return scored.slice(0, limit).map(({ item, viaContent }) => ({ item, viaContent }));
}
