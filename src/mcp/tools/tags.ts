import type { Canopy } from '../../shared/types.js';

/** Collect all tags from canopy with usage counts */
export function collectTags(canopy: Canopy): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fc of Object.values(canopy.files)) {
    for (const tag of fc.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/** Filter and sort tags. No search = top N by count. Search = substring match, alphabetical. */
export function searchTags(
  tags: Map<string, number>,
  search?: string,
  limit: number = 20,
  all: boolean = false,
): [string, number][] {
  let entries = [...tags.entries()];

  if (search) {
    const lower = search.toLowerCase();
    entries = entries.filter(([name]) => name.toLowerCase().includes(lower));
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  } else {
    entries.sort((a, b) => b[1] - a[1]);  // count descending
  }

  if (!all) {
    entries = entries.slice(0, limit);
  }
  return entries;
}

/** Levenshtein distance -- simple implementation for short strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalize tag separators for comparison */
export function normalizeSeparators(tag: string): string {
  return tag.replace(/[-_]/g, '').toLowerCase();
}

/** Find likely duplicate tag pairs */
export function findDuplicates(tags: Map<string, number>): [string, string][] {
  const names = [...tags.keys()];
  const dupes: [string, string][] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;

      // Check separator normalization
      if (normalizeSeparators(a) === normalizeSeparators(b)) {
        dupes.push([a, b]);
        seen.add(key);
        continue;
      }

      // Check Levenshtein distance <= 2
      if (levenshtein(a.toLowerCase(), b.toLowerCase()) <= 2) {
        dupes.push([a, b]);
        seen.add(key);
      }
    }
  }
  return dupes;
}

/** Build the full tags tool output */
export function buildTags(
  canopy: Canopy,
  search?: string,
  limit?: number,
  all?: boolean,
): string {
  const tags = collectTags(canopy);
  if (tags.size === 0) return 'No tags in use.';

  const results = searchTags(tags, search, limit ?? 20, all ?? false);
  const lines: string[] = [];

  if (search) {
    lines.push(`Tags matching "${search}":`);
  } else {
    lines.push(`Top ${results.length} tags (${tags.size} total):`);
  }

  for (const [name, count] of results) {
    lines.push(`  ${count.toString().padStart(3)}  ${name}`);
  }

  if (!all && !search && results.length < tags.size) {
    lines.push(`\n${tags.size - results.length} more -- use all=true or search to narrow`);
  }

  // Fuzzy duplicate warnings (scoped to visible results when searching)
  const dupes = findDuplicates(tags);
  const resultNames = new Set(results.map(([name]) => name));
  const relevantDupes = search
    ? dupes.filter(([a, b]) => resultNames.has(a) || resultNames.has(b))
    : dupes;
  if (relevantDupes.length > 0) {
    lines.push('');
    lines.push('Possible duplicates:');
    for (const [a, b] of relevantDupes) {
      lines.push(`  ${a} ~ ${b}`);
    }
  }

  return lines.join('\n');
}
