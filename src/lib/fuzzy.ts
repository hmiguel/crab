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

/** Items matching `query` in any field, best first (ties: shorter label), at most `limit`. */
export function rankItems<T>(
  query: string,
  items: T[],
  fields: (item: T) => string[],
  label: (item: T) => string,
  limit = 50,
): T[] {
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    let best: number | null = null;
    for (const f of fields(item)) {
      const s = fuzzyScore(query, f);
      if (s !== null && (best === null || s > best)) best = s;
    }
    if (best !== null) scored.push({ item, score: best });
  }
  // Array.prototype.sort is stable, so equal items keep their input order.
  scored.sort((a, b) => b.score - a.score || label(a.item).length - label(b.item).length);
  return scored.slice(0, limit).map((s) => s.item);
}
