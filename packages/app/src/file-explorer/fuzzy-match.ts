// Lightweight subsequence fuzzy matcher for the file finder. Client-side per
// the charter (the daemon just hands back the file list). Scores favor
// contiguous runs, matches right after a separator (path/camelCase boundary),
// basename hits, and earlier positions — enough to feel right without a
// heavyweight ranking library.

export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** 0-based indices in the haystack that matched, for highlight rendering. */
  positions: number[];
}

const SEPARATORS = new Set(["/", "\\", "_", "-", ".", " "]);

function scoreCandidate(
  haystack: string,
  lowerHaystack: string,
  lowerQuery: string,
): { score: number; positions: number[] } | null {
  if (lowerQuery.length === 0) {
    return { score: 0, positions: [] };
  }
  const positions: number[] = [];
  let queryIndex = 0;
  let score = 0;
  let previousMatch = -2;
  const basenameStart = Math.max(haystack.lastIndexOf("/"), haystack.lastIndexOf("\\")) + 1;

  for (let index = 0; index < haystack.length && queryIndex < lowerQuery.length; index += 1) {
    if (lowerHaystack[index] !== lowerQuery[queryIndex]) {
      continue;
    }
    positions.push(index);
    let bonus = 1;
    if (index === previousMatch + 1) {
      bonus += 5; // contiguous run
    }
    if (index === basenameStart || SEPARATORS.has(haystack[index - 1] ?? "")) {
      bonus += 8; // start of a path/word segment
    }
    if (index >= basenameStart) {
      bonus += 2; // basename matches read as more relevant than dir matches
    }
    if (haystack[index] === lowerQuery[queryIndex] && haystack[index] !== lowerHaystack[index]) {
      // exact-case on an uppercase boundary (camelCase acronym typing)
      bonus += 2;
    }
    score += bonus;
    previousMatch = index;
    queryIndex += 1;
  }

  if (queryIndex < lowerQuery.length) {
    return null;
  }
  // Prefer shorter haystacks when scores tie (less noise around the match).
  score -= haystack.length * 0.01;
  return { score, positions };
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  toHaystack: (item: T) => string,
  limit = 100,
): Array<FuzzyMatch<T>> {
  const lowerQuery = query.toLowerCase().replace(/\s+/g, "");
  const matches: Array<FuzzyMatch<T>> = [];
  for (const item of items) {
    const haystack = toHaystack(item);
    const scored = scoreCandidate(haystack, haystack.toLowerCase(), lowerQuery);
    if (scored) {
      matches.push({ item, score: scored.score, positions: scored.positions });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}
