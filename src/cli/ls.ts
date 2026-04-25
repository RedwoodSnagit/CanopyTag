#!/usr/bin/env node
/**
 * canopytag ls — lightweight summary view of annotated files
 *
 * Usage:
 *   canopytag ls                          # top 3 by authority (default)
 *   canopytag ls --limit 10               # top 10
 *   canopytag ls --all                    # everything
 *   canopytag ls --feature hilgar         # scoped to feature
 *   canopytag ls --tag physics            # scoped to tag
 *   canopytag ls --repo /path/to/repo     # specify repo root
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import {
  resolveCanopyPath, resolveRepoRoot, truncate, authorityScore, openTodoCount,
  CORE_OPTIONS, FILTER_OPTIONS, LIST_OPTIONS,
  parseBaseFilters, filterFiles, sortFiles, needsGitDates, fetchGitDates,
  collectFreshnessPaths, getFreshnessStatus, freshnessLabel,
  type SortKey, type FileFilters,
} from './shared.js';
import type { Canopy, FileCanopy } from '../shared/types.js';

interface FileRow {
  file: string;
  auth: string;
  status: string;
  review: string;
  feature: string;
  todos: string;
  summary: string;
}

export function buildLs(canopy: Canopy, filters: FileFilters, sortKey: SortKey, limit: number, repoRoot?: string): string {
  const lines: string[] = [];
  const entries = Object.entries(canopy.files);
  if (entries.length === 0) {
    return 'No annotated files found.';
  }

  // Fetch git dates lazily — only when filter or sort requires them
  const gitDates = needsGitDates(filters, sortKey)
    ? fetchGitDates(repoRoot ?? process.cwd(), entries.map(([p]) => p))
    : undefined;

  let filtered = filterFiles(entries, filters, gitDates);

  if (filtered.length === 0) {
    return 'No files match the given filters.';
  }

  filtered = sortFiles(filtered, sortKey, gitDates);

  // Limit
  const shown = filtered.slice(0, limit);
  const remaining = filtered.length - shown.length;
  const freshnessDates = (() => {
    const paths = collectFreshnessPaths(shown);
    if (paths.length === 0) return undefined;
    return fetchGitDates(repoRoot ?? process.cwd(), paths);
  })();

  // Build rows
  const rows: FileRow[] = shown.map(([filePath, fc]) => {
    const open = openTodoCount(fc);
    return {
      file: filePath,
      auth: fc.authorityLevel ?? '-',
      status: fc.status ?? '-',
      review: freshnessLabel(getFreshnessStatus(filePath, fc, freshnessDates)),
      feature: fc.featureId ?? '-',
      todos: open > 0 ? `${open} open` : '-',
      summary: truncate(fc.summary ?? '(no summary)', 60),
    };
  });

  // Column widths
  const cols = {
    file:    Math.max(4,  ...rows.map(r => r.file.length)),
    auth:    Math.max(4,  ...rows.map(r => r.auth.length)),
    status:  Math.max(6,  ...rows.map(r => r.status.length)),
    review:  Math.max(6,  ...rows.map(r => r.review.length)),
    feature: Math.max(7,  ...rows.map(r => r.feature.length)),
    todos:   Math.max(5,  ...rows.map(r => r.todos.length)),
  };

  // Header
  const header = [
    'FILE'.padEnd(cols.file),
    'AUTH'.padEnd(cols.auth),
    'STATUS'.padEnd(cols.status),
    'REVIEW'.padEnd(cols.review),
    'FEATURE'.padEnd(cols.feature),
    'TODOS'.padEnd(cols.todos),
    'SUMMARY',
  ].join('  ');

  const sep = '-'.repeat(header.length);

  lines.push(header);
  lines.push(sep);
  for (const r of rows) {
    lines.push([
      r.file.padEnd(cols.file),
      r.auth.padEnd(cols.auth),
      r.status.padEnd(cols.status),
      r.review.padEnd(cols.review),
      r.feature.padEnd(cols.feature),
      r.todos.padEnd(cols.todos),
      r.summary,
    ].join('  '));
  }

  if (remaining > 0) {
    const parts: string[] = [`${remaining} more with --limit ${filtered.length} or --all`];
    if (sortKey !== 'recent' && filtered.some(([, fc]: [string, FileCanopy]) => fc.lastReviewed)) {
      parts.push('try --sort recent');
    }
    lines.push(`\n[${parts.join(' | ')}]`);
  }

  // Total stats
  const totalOpen = filtered.reduce((sum, [, fc]) => sum + openTodoCount(fc), 0);
  if (totalOpen > 0) {
    lines.push(`\n${totalOpen} open TODOs across ${filtered.length} annotated files.`);
  }

  return lines.join('\n');
}

function run() {
  const { values } = parseArgs({
    options: { ...CORE_OPTIONS, ...FILTER_OPTIONS, ...LIST_OPTIONS },
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag ls — list annotated files

Options:
  -r, --repo <path>      Repo root (default: cwd)
  -f, --feature <name>   Filter by feature ID
  -t, --tag <name>       Filter by tag
      --tagged-after <date>     Annotation reviewed on or after ISO date
      --tagged-before <date>    Annotation reviewed on or before ISO date
      --git-after <date>        Source file git-modified on or after ISO date
      --git-before <date>       Source file git-modified on or before ISO date
  -k, --kind <type>      Filter by file kind: doc, code, test, config, asset, data
      --unreviewed       Only files with unreviewed scores
      --surprising       Only files tagged 'surprising' or with finding comments
  -s, --sort <key>       Sort: authority (default), recent, modified, name, todos,
                         priority, scores (lowest first), stability, attention
  -n, --limit <count>    Number of results (default: 3)
  -a, --all              Show all results
  -h, --help             Show this help`);
    return;
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
  const limit = values.all ? Object.keys(canopy.files).length : parseInt(values.limit as string, 10) || 3;

  console.log(buildLs(canopy, filters, sortKey, limit, repoRoot));
}

// Guard: don't run when imported as a module (e.g. in tests)
const isDirectRun = process.argv[1]?.endsWith('ls.ts') || process.argv[1]?.endsWith('ls.js');
if (isDirectRun) run();
