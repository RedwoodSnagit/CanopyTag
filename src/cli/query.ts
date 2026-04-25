#!/usr/bin/env node
/**
 * canopytag query — progressive detail query with relation filtering
 *
 * Usage:
 *   canopytag query --feature tire_pressure                      # default: detail 1 (low)
 *   canopytag query --feature tire_pressure --detail 2           # + connections + TODOs
 *   canopytag query --feature tire_pressure --detail 5           # everything
 *   canopytag query --feature tire_pressure --detail medium      # named alias for 2
 *   canopytag query --feature tire_pressure --relation implements # only code
 *   canopytag query --feature tire_pressure --relation doc-for   # only docs
 *   canopytag query --detail 3 --limit 5                         # across whole repo
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import { trackCanopyQueries } from '../backend/lib/analytics.js';
import { normalizeRelation, checkAuthorityHealth } from '../shared/types.js';
import type {
  Canopy, FileCanopy, FileRelation, RelationType,
  AuthorityLevel, AuthorityHealth, Todo,
} from '../shared/types.js';
import {
  resolveCanopyPath, resolveRepoRoot, truncate, authorityScore, openTodoCount, highestTodoPriority,
  CORE_OPTIONS, FILTER_OPTIONS, LIST_OPTIONS,
  parseBaseFilters, filterFiles, sortFiles, needsGitDates, fetchGitDates,
  collectFreshnessPaths, getFreshnessStatus, freshnessLabel,
  type SortKey, type FileFilters,
} from './shared.js';

// Detail is 1-5. Higher = more content. Named aliases for convenience.
// 1 = low:          top files only, no connections
// 2 = medium:       + tight connections (closeness ≥ 4) + TODOs (top 5)
// 3 = medium-high:  + moderate connections (closeness >= 3), two-hop walk
// 4 = high:         + loose connections (closeness >= 2), three-hop walk + deprecated files
// 5 = full:         everything, unrestricted connection walk

const DETAIL_ALIASES: Record<string, number> = {
  low: 1,
  medium: 2,
  'medium-high': 3,
  high: 4,
  full: 5,
};

const DETAIL_NAMES: Record<number, string> = {
  1: 'low',
  2: 'medium',
  3: 'medium-high',
  4: 'high',
  5: 'full',
};

function parseDetail(raw: string | undefined): number {
  if (!raw) return 1;  // default: low
  // Try as number first
  const num = parseInt(raw, 10);
  if (num >= 1 && num <= 5) return num;
  // Try as named alias
  const alias = DETAIL_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  return -1;  // invalid
}

const VALID_RELATIONS = new Set([
  'doc-for', 'test-of', 'implements', 'procedure-for', 'audit-of', 'update-on', 'fed-by',
]);

function getOpenTodos(fc: FileCanopy): Todo[] {
  return (fc.todos ?? []).filter(t => t.status === 'open' || t.status === 'in_progress');
}

function authLabel(fc: FileCanopy): string {
  const labels: Record<string, string> = {
    standard: 'STD ',
    specification: 'SPEC',
    guideline: 'GUIDE',
    blueprint: 'BLPR',
    idea: 'IDEA',
  };
  return labels[fc.authorityLevel ?? ''] ?? '    ';
}

function statusFlag(fc: FileCanopy): string {
  if (fc.status === 'deprecated') return ' [DEPRECATED]';
  if (fc.status === 'experimental') return ' [EXPERIMENTAL]';
  if (fc.status === 'draft') return ' [DRAFT]';
  return '';
}

function healthFlag(fc: FileCanopy): string {
  const h = checkAuthorityHealth(fc);
  if (!h) return '';
  if (h.status === 'underscored') return ' !! underscored';
  if (h.status === 'promotion-candidate') return ' ^^ promotion candidate';
  return '';
}

interface QueryResult {
  filePath: string;
  fc: FileCanopy;
  matchReason: 'direct' | 'connection';
  connectionFrom?: string;
  connectionRelation?: RelationType;
  connectionCloseness?: number;
  connectionHops?: number;
}

export interface BuildQueryResult {
  text: string;
  matchedPaths: string[];
}

export interface QueryOptions {
  detail?: number;
  relation?: RelationType;
  sortKey?: SortKey;
  limit?: number;
  showAll?: boolean;
  repoRoot?: string;
}

export function buildQuery(canopy: Canopy, filters: FileFilters, opts: QueryOptions = {}): BuildQueryResult {
  const lines: string[] = [];
  const detail = opts.detail ?? 1;
  const detailName = DETAIL_NAMES[detail] ?? `${detail}`;
  const relationFilter = opts.relation;
  const sortKey = opts.sortKey ?? 'authority';
  const repoRoot = opts.repoRoot;

  // Don't mutate caller's filters — create a copy with detail-derived settings
  const resolvedFilters = { ...filters, includeDeprecated: opts.showAll || detail >= 4 };

  const allEntries = Object.entries(canopy.files);
  const gitDates = needsGitDates(resolvedFilters, sortKey)
    ? fetchGitDates(repoRoot ?? process.cwd(), allEntries.map(([p]) => p))
    : undefined;

  let directMatches = filterFiles(allEntries, resolvedFilters, gitDates);

  if (directMatches.length === 0) {
    return { text: 'No files match the given filters.', matchedPaths: [] };
  }

  directMatches = sortFiles(directMatches, sortKey, gitDates);

  // Apply limit — scales with detail
  const defaultLimits: Record<number, number> = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 999 };
  const limit = opts.limit || (defaultLimits[detail] ?? 10);
  const limited = directMatches.slice(0, limit);

  // Step 2: Collect connections at this detail level
  // minCloseness maps: detail 2→4, 3→3, 4→2, 5→1
  const minCloseness = 6 - detail;
  const results: QueryResult[] = [];
  const seen = new Set<string>();

  for (const [filePath, fc] of limited) {
    seen.add(filePath);
    results.push({ filePath, fc, matchReason: 'direct' });
  }

  // Walk connections (detail 2 and above). Detail 2 stays compact and one-hop;
  // higher detail levels progressively include connections-of-connections.
  if (detail >= 2) {
    const maxHops = detail === 2
      ? 1
      : detail === 3
        ? 2
        : detail === 4
          ? 3
          : Number.POSITIVE_INFINITY;
    let frontier = limited.map(([filePath, fc]) => ({ filePath, fc, hops: 0 }));

    while (frontier.length > 0) {
      const nextFrontier: typeof frontier = [];

      for (const { filePath, fc, hops } of frontier) {
        if (hops >= maxHops) continue;

        const relations = (fc.relatedFiles ?? []).map(normalizeRelation);
        for (const rel of relations) {
          const closeness = rel.closeness ?? 3;
          if (closeness < minCloseness) continue;
          if (relationFilter && rel.relation !== relationFilter) continue;
          if (seen.has(rel.path)) continue;

          const connectedFc = canopy.files[rel.path];
          if (connectedFc) {
            seen.add(rel.path);
            const connectionHops = hops + 1;
            results.push({
              filePath: rel.path,
              fc: connectedFc,
              matchReason: 'connection',
              connectionFrom: filePath,
              connectionRelation: rel.relation,
              connectionCloseness: closeness,
              connectionHops,
            });
            nextFrontier.push({ filePath: rel.path, fc: connectedFc, hops: connectionHops });
          }
        }
      }

      frontier = nextFrontier;
    }
  }

  // Step 3: Render output
  const featureName = filters.feature;
  const tagName = filters.tag;
  const featureObj = featureName ? canopy.features[featureName] ?? canopy.features[featureName.toLowerCase()] : undefined;
  const heading = featureName
    ? `${featureName}${featureObj?.name ? ` — ${featureObj.name}` : ''}`
    : tagName ? `tag: ${tagName}` : 'all files';

  const detailLabel = `detail ${detail}/${detailName}`;
  lines.push(`── ${heading} (${detailLabel}) ${'─'.repeat(Math.max(1, 60 - heading.length - detailLabel.length - 6))}`);
  if (featureObj?.description) {
    lines.push(truncate(featureObj.description, 80));
  }
  lines.push('');

  // Group: direct matches first, then connections
  const directResults = results.filter(r => r.matchReason === 'direct');
  const connectionResults = results.filter(r => r.matchReason === 'connection');
  const freshnessDates = (() => {
    const paths = collectFreshnessPaths(results.map(({ filePath, fc }) => [filePath, fc] as [string, FileCanopy]));
    if (paths.length === 0) return undefined;
    return fetchGitDates(repoRoot ?? process.cwd(), paths);
  })();

  for (const { filePath, fc } of directResults) {
    const label = authLabel(fc);
    const flag = statusFlag(fc);
    const hflag = healthFlag(fc);
    const review = freshnessLabel(getFreshnessStatus(filePath, fc, freshnessDates));
    lines.push(`${label}  ${filePath}${flag}${hflag}`);
    if (fc.summary) {
      lines.push(`      ${truncate(fc.summary, 74)}`);
    }
    lines.push(`      Review: ${review}`);

    const open = getOpenTodos(fc);
    if (open.length > 0 && detail >= 2) {
      const hp = Math.min(...open.map(t => t.priority));
      lines.push(`      ${open.length} open TODO${open.length > 1 ? 's' : ''} (highest: P${hp})`);
    }

    // Show inline connections for this file
    if (detail >= 2) {
      const relations = (fc.relatedFiles ?? []).map(normalizeRelation);
      const filtered = relations
        .filter(r => (r.closeness ?? 3) >= minCloseness)
        .filter(r => !relationFilter || r.relation === relationFilter)
        .sort((a, b) => (b.closeness ?? 3) - (a.closeness ?? 3));

      for (const rel of filtered) {
        const relLabel = rel.relation ? `[${rel.relation}]` : '';
        const closeLabel = rel.closeness ? ` (${rel.closeness}/5)` : '';
        lines.push(`      → ${relLabel.padEnd(16)} ${rel.path}${closeLabel}`);
      }
    }

    lines.push('');
  }

  // Show connected files that were pulled in
  if (connectionResults.length > 0) {
    lines.push('── connected ──');
    lines.push('');
    for (const { filePath, fc, connectionFrom, connectionRelation, connectionCloseness, connectionHops } of connectionResults) {
      const label = authLabel(fc);
      const relLabel = connectionRelation ? `[${connectionRelation}]` : '';
      const closeLabel = connectionCloseness ? ` (${connectionCloseness}/5)` : '';
      const hopLabel = connectionHops && connectionHops > 1 ? ` hop ${connectionHops}` : '';
      const viaLabel = connectionFrom ? ` via ${connectionFrom}` : '';
      const review = freshnessLabel(getFreshnessStatus(filePath, fc, freshnessDates));
      lines.push(`${label}  ${filePath}  ${relLabel}${closeLabel}${hopLabel}${viaLabel}`);
      if (fc.summary) {
        lines.push(`      ${truncate(fc.summary, 74)}`);
      }
      lines.push(`      Review: ${review}`);
      lines.push('');
    }
  }

  // Show TODOs at detail 2 and above
  if (detail >= 2) {
    const allTodos: { filePath: string; todo: Todo }[] = [];
    for (const { filePath, fc } of results) {
      for (const todo of getOpenTodos(fc)) {
        allTodos.push({ filePath, todo });
      }
    }

    if (allTodos.length > 0) {
      allTodos.sort((a, b) => a.todo.priority - b.todo.priority);
      const todoLimit = detail <= 2 ? 5 : detail === 3 ? 15 : 999;
      const todoShown = allTodos.slice(0, todoLimit);

      lines.push('── open TODOs ──');
      lines.push('');
      for (const { todo } of todoShown) {
        const diff = todo.difficulty ? ` D${todo.difficulty}` : '';
        lines.push(`  ${todo.id}  P${todo.priority}${diff}  ${truncate(todo.text, 65)}`);
      }
      if (allTodos.length > todoLimit) {
        lines.push(`  ... ${allTodos.length - todoLimit} more`);
      }
      lines.push('');
    }
  }

  // Summary line — tell the agent what it's seeing and what it's missing
  const shownCount = limited.length;
  const connectionCount = connectionResults.length;
  const parts = [`${shownCount} file${shownCount !== 1 ? 's' : ''} shown`];
  if (connectionCount > 0) parts.push(`${connectionCount} connected`);

  // Count what's hidden: files excluded by depth filters or limit
  let totalInScope: [string, FileCanopy][];
  if (featureName) {
    const feat = featureName.toLowerCase();
    totalInScope = allEntries.filter(([, fc]) => fc.featureId?.toLowerCase() === feat);
  } else if (tagName) {
    const tag = tagName.toLowerCase();
    totalInScope = allEntries.filter(([, fc]) => (fc.tags ?? []).some(t => t.toLowerCase() === tag));
  } else {
    totalInScope = allEntries;
  }

  const hiddenByLimit = directMatches.length - shownCount;
  const deprecatedCount = totalInScope.filter(([, fc]) => fc.status === 'deprecated').length;
  const hiddenDeprecated = detail <= 3 ? deprecatedCount : 0;

  if (hiddenByLimit > 0) parts.push(`${hiddenByLimit} more with --limit ${directMatches.length}`);
  if (hiddenDeprecated > 0) parts.push(`${hiddenDeprecated} deprecated (visible at detail ≥ 4)`);
  if (detail < 5) parts.push(`wider: --detail ${detail + 1}`);
  if (sortKey !== 'recent' && results.some(r => r.fc.lastReviewed)) {
    parts.push('try --sort recent');
  }

  lines.push(`[${parts.join(' | ')}]`);

  return { text: lines.join('\n'), matchedPaths: results.map(r => r.filePath) };
}

function run() {
  const { values } = parseArgs({
    options: {
      ...CORE_OPTIONS, ...FILTER_OPTIONS, ...LIST_OPTIONS,
      detail:   { type: 'string', short: 'd' },
      relation: { type: 'string' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag query — progressive detail query

Detail (1-5, or named alias):
  1 | low          Top files only, no connections (default)
  2 | medium       + closeness ≥ 4 connections + open TODOs (top 5)
  3 | medium-high  + closeness >= 3, two-hop connections + more TODOs
  4 | high         + closeness >= 2, three-hop connections + deprecated files
  5 | full         Everything, unrestricted connection walk

Options:
  -r, --repo <path>         Repo root (default: cwd)
  -f, --feature <name>      Filter by feature ID
  -t, --tag <name>          Filter by tag
  -d, --detail <1-5|name>   Detail level (default: 1)
      --relation <type>     Filter connections: doc-for|test-of|implements|
                            procedure-for|audit-of|update-on|fed-by
  -k, --kind <type>         Filter by file kind: doc|code|test|config|asset|data
      --unreviewed          Only files with unreviewed scores
      --surprising          Only files tagged 'surprising' or with finding comments
  -s, --sort <key>          Sort: authority|recent|modified|name|todos|
                            priority|scores|stability|attention
      --tagged-after <date>      Annotation reviewed after ISO date
      --tagged-before <date>     Annotation reviewed before ISO date
      --git-after <date>         Source file git-modified after ISO date
      --git-before <date>        Source file git-modified before ISO date
  -a, --all                 Include deprecated/archived files
  -n, --limit <count>       Max direct files (default: varies by detail)
  -h, --help                Show this help`);
    return;
  }

  const detail = parseDetail(values.detail as string | undefined);
  if (detail === -1) {
    console.error(`Invalid detail: ${values.detail}. Use: 1-5, or low/medium/medium-high/high/full`);
    process.exit(1);
  }

  const relationFilter = values.relation as RelationType | undefined;
  if (relationFilter && !VALID_RELATIONS.has(relationFilter)) {
    console.error(`Invalid relation: ${values.relation}. Use: ${[...VALID_RELATIONS].join(', ')}`);
    process.exit(1);
  }

  const repoRoot = resolveRepoRoot(values.repo as string | undefined);
  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const canopy = readCanopy(canopyPath);

  let filters: FileFilters;
  try {
    filters = parseBaseFilters(values);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }

  const sortKey = (values.sort as SortKey | undefined) ?? 'authority';
  const limit = parseInt(values.limit as string, 10) || undefined;

  const result = buildQuery(canopy, filters, {
    detail,
    relation: relationFilter,
    sortKey,
    limit,
    showAll: values.all as boolean | undefined,
    repoRoot,
  });

  if ((filters.feature || filters.tag) && result.matchedPaths.length > 0) {
    trackCanopyQueries(repoRoot, result.matchedPaths);
  }

  console.log(result.text);
}

// Guard: don't run when imported as a module (e.g. in tests)
const isDirectRun = process.argv[1]?.endsWith('query.ts') || process.argv[1]?.endsWith('query.js');
if (isDirectRun) run();
