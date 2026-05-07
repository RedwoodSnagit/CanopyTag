import path from 'node:path';
import type { FileCanopy, FileKind, FreshnessStatus } from '../shared/types.js';
import { EXTENSION_KIND_MAP, checkFreshness, normalizeRelation } from '../shared/types.js';
import { getLastModifiedBatch } from '../backend/lib/git-info.js';

// ---- Utilities ----

export function resolveRepoRoot(repoArg?: string): string {
  return repoArg ?? process.env.REPO_ROOT ?? process.cwd();
}

export function resolveCanopyPath(repoArg?: string): string {
  const root = resolveRepoRoot(repoArg);
  return path.join(root, 'canopytag', 'canopy.json');
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export const AUTHORITY_RANK: Record<string, number> = {
  standard: 5,
  specification: 4,
  guideline: 3,
  blueprint: 2,
  idea: 1,
};

export function authorityScore(fc: FileCanopy): number {
  return AUTHORITY_RANK[fc.authorityLevel ?? ''] ?? 0;
}

export function openTodoCount(fc: FileCanopy): number {
  return (fc.todos ?? []).filter(t => t.status === 'open' || t.status === 'in_progress').length;
}

export function highestTodoPriority(fc: FileCanopy): number {
  const open = (fc.todos ?? []).filter(t => t.status === 'open' || t.status === 'in_progress');
  if (open.length === 0) return 99;
  return Math.min(...open.map(t => t.priority));
}

export function fileKind(filePath: string): FileKind {
  const lower = filePath.toLowerCase();
  if (lower.includes('/test') || lower.includes('test_') || lower.includes('_test.') || lower.includes('.test.')) {
    return 'test';
  }
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_KIND_MAP[ext] ?? 'unknown';
}

export function aggregateScore(fc: FileCanopy): number {
  const scores = [fc.validity, fc.clarity, fc.completeness, fc.stability];
  const defined = scores.filter((s): s is number => s != null);
  return defined.length > 0 ? defined.reduce((a, b) => a + b, 0) : 0;
}

/** Count of dimension warnings — scores below expected minimum for the file's authority level */
export function warningCount(fc: FileCanopy): number {
  if (!fc.authorityLevel) return 0;
  const MINS: Record<string, number> = { idea: 0, blueprint: 1, guideline: 2, specification: 3, standard: 4 };
  const min = MINS[fc.authorityLevel] ?? 0;
  if (min === 0) return 0;
  let count = 0;
  for (const dim of ['validity', 'clarity', 'completeness', 'stability'] as const) {
    const score = fc[dim];
    if (score != null && score < min) count++;
  }
  return count;
}

export function collectFreshnessPaths(entries: [string, FileCanopy][], minCloseness = 4): string[] {
  const paths = new Set<string>();
  for (const [filePath, fc] of entries) {
    if (!fc.lastReviewed) continue;
    paths.add(filePath);
    for (const relation of (fc.relatedFiles ?? []).map(normalizeRelation)) {
      if ((relation.closeness ?? 3) >= minCloseness) {
        paths.add(relation.path);
      }
    }
  }
  return [...paths];
}

export function getFreshnessStatus(
  filePath: string,
  fc: FileCanopy,
  gitDates?: Map<string, string>,
  minCloseness = 4,
): FreshnessStatus {
  if (!fc.lastReviewed) return 'unknown';

  const relatedModifiedDates = (fc.relatedFiles ?? [])
    .map(normalizeRelation)
    .filter(relation => (relation.closeness ?? 3) >= minCloseness)
    .map(relation => gitDates?.get(relation.path))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return checkFreshness({
    lastModified: gitDates?.get(filePath),
    lastReviewed: fc.lastReviewed,
    relatedModifiedDates,
  }) ?? 'fresh';
}

export function freshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case 'review-drift':
      return 'Review Drift';
    case 'fresh':
      return 'Fresh';
    default:
      return 'Unknown';
  }
}

// ---- Composable option groups ----

export const CORE_OPTIONS = {
  repo: { type: 'string' as const, short: 'r' as const },
  help: { type: 'boolean' as const, short: 'h' as const },
};

export const FILTER_OPTIONS = {
  feature:          { type: 'string' as const, short: 'f' as const },
  tag:              { type: 'string' as const, short: 't' as const },
  kind:             { type: 'string' as const, short: 'k' as const },
  unreviewed:       { type: 'boolean' as const },
  surprising:       { type: 'boolean' as const },
  'tagged-after':   { type: 'string' as const },
  'tagged-before':  { type: 'string' as const },
  'git-after':      { type: 'string' as const },
  'git-before':     { type: 'string' as const },
};

export const LIST_OPTIONS = {
  sort:  { type: 'string' as const, short: 's' as const },
  limit: { type: 'string' as const, short: 'n' as const },
  all:   { type: 'boolean' as const, short: 'a' as const },
};

// ---- FileFilters and filterFiles ----

export const VALID_KINDS = new Set<string>(['module', 'doc', 'config', 'test', 'asset', 'data']);
export const KIND_ALIASES: Record<string, string> = {
  code: 'module', docs: 'doc', documentation: 'doc',
};

export interface FileFilters {
  feature?: string;
  tag?: string;
  kind?: string;           // file kind: doc, module/code, test, config, etc.
  unreviewed?: boolean;    // only show files with scoresReviewed !== true
  surprising?: boolean;    // files tagged 'surprising' OR with any finding-type comment
  taggedAfter?: string;    // lastReviewed >= date
  taggedBefore?: string;   // lastReviewed <= date
  gitAfter?: string;       // git last modified >= date
  gitBefore?: string;      // git last modified <= date
  includeDeprecated?: boolean;  // default true
}

/** A file is surprising if it has the 'surprising' tag OR any finding-type comment */
export function isSurprising(fc: FileCanopy): boolean {
  if ((fc.tags ?? []).some(t => t.toLowerCase() === 'surprising')) return true;
  if ((fc.comments ?? []).some(c => c.type === 'finding')) return true;
  return false;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;

export function parseBaseFilters(values: Record<string, unknown>): FileFilters {
  const filters: FileFilters = {};
  if (values.feature) filters.feature = values.feature as string;
  if (values.tag) filters.tag = values.tag as string;
  if (values.kind) {
    const raw = (values.kind as string).toLowerCase();
    const resolved = KIND_ALIASES[raw] ?? raw;
    if (!VALID_KINDS.has(resolved)) {
      throw new Error(`Invalid --kind: ${values.kind}. Use: doc, code, test, config, asset, data`);
    }
    filters.kind = resolved;
  }
  if (values.unreviewed) filters.unreviewed = true;
  if (values.surprising) filters.surprising = true;
  const taggedAfter = values['tagged-after'] as string | undefined;
  if (taggedAfter) {
    if (!ISO_DATE_RE.test(taggedAfter)) {
      throw new Error(`Invalid date: ${taggedAfter}. Use ISO format: 2026-03-28 or 2026-03-28T14:00:00Z`);
    }
    filters.taggedAfter = taggedAfter;
  }
  const taggedBefore = values['tagged-before'] as string | undefined;
  if (taggedBefore) {
    if (!ISO_DATE_RE.test(taggedBefore)) {
      throw new Error(`Invalid date: ${taggedBefore}. Use ISO format: 2026-03-28 or 2026-03-28T14:00:00Z`);
    }
    filters.taggedBefore = taggedBefore;
  }
  // --git-after
  const gitAfter = values['git-after'] as string | undefined;
  if (gitAfter) {
    if (!ISO_DATE_RE.test(gitAfter)) {
      throw new Error(`Invalid date: ${gitAfter}. Use ISO format: 2026-03-28 or 2026-03-28T14:00:00Z`);
    }
    filters.gitAfter = gitAfter;
  }
  // --git-before
  const gitBefore = values['git-before'] as string | undefined;
  if (gitBefore) {
    if (!ISO_DATE_RE.test(gitBefore)) {
      throw new Error(`Invalid date: ${gitBefore}. Use ISO format: 2026-03-28 or 2026-03-28T14:00:00Z`);
    }
    filters.gitBefore = gitBefore;
  }
  return filters;
}

export function filterFiles(
  entries: [string, FileCanopy][],
  filters: FileFilters = {},
  gitDates?: Map<string, string>,
): [string, FileCanopy][] {
  let result = entries;
  if (filters.feature) {
    const feat = filters.feature.toLowerCase();
    result = result.filter(([, fc]) => fc.featureId?.toLowerCase() === feat);
  }
  if (filters.tag) {
    const tag = filters.tag.toLowerCase();
    result = result.filter(([, fc]) =>
      (fc.tags ?? []).some(t => t.toLowerCase() === tag)
    );
  }
  if (filters.kind) {
    const k = filters.kind;
    result = result.filter(([filePath]) => fileKind(filePath) === k);
  }
  if (filters.unreviewed) {
    result = result.filter(([, fc]) => fc.scoresReviewed !== true);
  }
  if (filters.surprising) {
    result = result.filter(([, fc]) => isSurprising(fc));
  }
  if (filters.taggedAfter) {
    const after = filters.taggedAfter;
    result = result.filter(([, fc]) => fc.lastReviewed != null && fc.lastReviewed >= after);
  }
  if (filters.taggedBefore) {
    const before = filters.taggedBefore;
    result = result.filter(([, fc]) => fc.lastReviewed != null && fc.lastReviewed <= before);
  }
  if (filters.gitAfter && gitDates) {
    const after = filters.gitAfter;
    result = result.filter(([filePath]) => {
      const mod = gitDates.get(filePath);
      return mod != null && mod >= after;
    });
  }
  if (filters.gitBefore && gitDates) {
    const before = filters.gitBefore;
    result = result.filter(([filePath]) => {
      const mod = gitDates.get(filePath);
      return mod != null && mod <= before;
    });
  }
  if (filters.includeDeprecated === false) {
    result = result.filter(([, fc]) => fc.status !== 'deprecated' && fc.status !== 'archived');
  }
  return result;
}

// ---- Git date helpers ----

/** Returns true if the filters or sort key require git modification dates */
export function needsGitDates(filters: FileFilters, sortKey?: SortKey): boolean {
  return !!(filters.gitAfter || filters.gitBefore || sortKey === 'modified');
}

/** Fetch git dates for a set of file paths. Only call when needsGitDates() is true. */
export function fetchGitDates(repoRoot: string, filePaths: string[]): Map<string, string> {
  return getLastModifiedBatch(repoRoot, filePaths);
}

// ---- SortKey and sortFiles ----

export type SortKey = 'authority' | 'recent' | 'modified' | 'name' | 'todos' | 'priority' | 'scores' | 'stability' | 'attention';

export function sortFiles(
  entries: [string, FileCanopy][],
  sortKey: SortKey = 'authority',
  gitDates?: Map<string, string>,
): [string, FileCanopy][] {
  const sorted = [...entries];
  switch (sortKey) {
    case 'authority':
      sorted.sort((a, b) => {
        const authDiff = authorityScore(b[1]) - authorityScore(a[1]);
        if (authDiff !== 0) return authDiff;
        return openTodoCount(b[1]) - openTodoCount(a[1]);
      });
      break;
    case 'recent':
      sorted.sort((a, b) => {
        const aDate = a[1].lastReviewed ?? '';
        const bDate = b[1].lastReviewed ?? '';
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return a[0].localeCompare(b[0]);
      });
      break;
    case 'modified':
      // Sort by git last-modified date (most recent first)
      sorted.sort((a, b) => {
        const aDate = gitDates?.get(a[0]) ?? '';
        const bDate = gitDates?.get(b[0]) ?? '';
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return a[0].localeCompare(b[0]);
      });
      break;
    case 'name':
      sorted.sort((a, b) => a[0].localeCompare(b[0]));
      break;
    case 'todos':
      sorted.sort((a, b) => {
        const todoDiff = openTodoCount(b[1]) - openTodoCount(a[1]);
        if (todoDiff !== 0) return todoDiff;
        return authorityScore(b[1]) - authorityScore(a[1]);
      });
      break;
    case 'priority':
      sorted.sort((a, b) => {
        const priDiff = highestTodoPriority(a[1]) - highestTodoPriority(b[1]);
        if (priDiff !== 0) return priDiff;
        return a[0].localeCompare(b[0]);
      });
      break;
    case 'scores':
      // Lowest aggregate first — "what needs work"
      sorted.sort((a, b) => {
        const scoreDiff = aggregateScore(a[1]) - aggregateScore(b[1]);
        if (scoreDiff !== 0) return scoreDiff;
        return authorityScore(b[1]) - authorityScore(a[1]);  // tiebreak: higher authority first
      });
      break;
    case 'stability':
      // Lowest stability first — "what's most volatile"
      sorted.sort((a, b) => {
        const aStab = a[1].stability ?? 99;
        const bStab = b[1].stability ?? 99;
        if (aStab !== bStab) return aStab - bStab;
        return authorityScore(b[1]) - authorityScore(a[1]);
      });
      break;
    case 'attention':
      // Composite: most warnings + unreviewed + open TODOs + low scores, weighted by authority
      // Higher score = needs more attention, sorted descending
      sorted.sort((a, b) => {
        const attentionScore = (fc: FileCanopy): number => {
          let score = 0;
          score += warningCount(fc) * 3;               // dimension warnings are heavy
          if (fc.scoresReviewed !== true) score += 2;   // unreviewed
          score += openTodoCount(fc);                    // open TODOs
          score += Math.max(0, 3 - (fc.stability ?? 3)); // instability bonus
          // weight by authority — a neglected spec matters more than a neglected idea
          score *= (1 + authorityScore(fc) * 0.5);
          return score;
        };
        const diff = attentionScore(b[1]) - attentionScore(a[1]);
        if (diff !== 0) return diff;
        return a[0].localeCompare(b[0]);
      });
      break;
  }
  return sorted;
}
