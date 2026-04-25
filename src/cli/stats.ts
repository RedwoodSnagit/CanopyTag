#!/usr/bin/env node
/**
 * canopytag stats — orient before you dive
 *
 * The first call an agent should make. Shows what material exists
 * for a tag, feature, or the whole repo: file counts by kind,
 * authority distribution, open TODOs.
 *
 * Usage:
 *   canopytag stats                          # whole repo overview
 *   canopytag stats --tag rolling_resistance  # scoped to tag
 *   canopytag stats --feature tire_pressure   # scoped to feature
 *   canopytag stats --repo /path/to/repo      # specify repo root
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import {
  resolveCanopyPath, resolveRepoRoot, AUTHORITY_RANK, fileKind,
  CORE_OPTIONS, FILTER_OPTIONS,
  parseBaseFilters, filterFiles,
  type FileFilters,
} from './shared.js';
import {
  resolveAnalyticsPath, readAnalytics, engagementScore, windowedTotals,
} from '../backend/lib/analytics.js';
import type { Canopy, FileCanopy, AuthorityLevel, FileKind } from '../shared/types.js';

const KIND_LABELS: Record<FileKind, string> = {
  module: 'CODE',
  doc: 'DOCS',
  config: 'CONFIG',
  test: 'TEST',
  asset: 'ASSET',
  data: 'DATA',
  unknown: 'OTHER',
};

// Display order for kinds
const KIND_ORDER: FileKind[] = ['doc', 'module', 'test', 'config', 'data', 'asset', 'unknown'];

export function buildStats(canopy: Canopy, filters: FileFilters, repoRoot?: string): string {
  const lines: string[] = [];
  let entries = Object.entries(canopy.files);
  entries = filterFiles(entries, filters);

  if (entries.length === 0) {
    return 'No annotated files match.';
  }

  // Scope label
  const featureName = filters.feature;
  const tagName = filters.tag;
  const scope = featureName
    ? `feature: ${featureName}`
    : tagName
      ? `tag: ${tagName}`
      : 'all annotated files';

  lines.push(`${scope}: ${entries.length} files`);
  lines.push('');

  // Count by kind, with authority breakdown
  const kindCounts = new Map<FileKind, { total: number; byAuth: Map<string, number> }>();
  let totalOpenTodos = 0;
  let highAuthCount = 0; // spec or standard

  for (const [filePath, fc] of entries) {
    const kind = fileKind(filePath);
    if (!kindCounts.has(kind)) {
      kindCounts.set(kind, { total: 0, byAuth: new Map() });
    }
    const bucket = kindCounts.get(kind)!;
    bucket.total++;

    const auth = fc.authorityLevel ?? 'unscored';
    bucket.byAuth.set(auth, (bucket.byAuth.get(auth) ?? 0) + 1);

    if (fc.authorityLevel && AUTHORITY_RANK[fc.authorityLevel] >= 4) {
      highAuthCount++;
    }

    const openTodos = (fc.todos ?? []).filter(t => t.status === 'open' || t.status === 'in_progress').length;
    totalOpenTodos += openTodos;
  }

  // Print kind rows
  for (const kind of KIND_ORDER) {
    const bucket = kindCounts.get(kind);
    if (!bucket) continue;

    const label = KIND_LABELS[kind].padEnd(6);
    const authParts: string[] = [];
    // Sort auth entries by rank descending
    const authEntries = [...bucket.byAuth.entries()].sort((a, b) =>
      (AUTHORITY_RANK[b[0]] ?? 0) - (AUTHORITY_RANK[a[0]] ?? 0)
    );
    for (const [auth, count] of authEntries) {
      authParts.push(`${count} ${auth}`);
    }
    lines.push(`  ${label} ${String(bucket.total).padStart(3)}  (${authParts.join(', ')})`);
  }

  lines.push('');

  // Summary line
  const parts: string[] = [];
  if (highAuthCount > 0) {
    parts.push(`Authority ≥ spec: ${highAuthCount} files`);
  }
  if (totalOpenTodos > 0) {
    parts.push(`Open TODOs: ${totalOpenTodos}`);
  }

  // Status breakdown (deprecated, draft, experimental)
  const statusCounts = new Map<string, number>();
  for (const [, fc] of entries) {
    if (fc.status && fc.status !== 'active') {
      statusCounts.set(fc.status, (statusCounts.get(fc.status) ?? 0) + 1);
    }
  }
  for (const [status, count] of statusCounts) {
    parts.push(`${count} ${status}`);
  }

  // Features in scope (if not already filtered by feature)
  if (!featureName) {
    const features = new Set<string>();
    for (const [, fc] of entries) {
      if (fc.featureId) features.add(fc.featureId);
    }
    if (features.size > 0) {
      parts.push(`${features.size} features`);
    }
  }

  for (const p of parts) {
    lines.push(`  ${p}`);
  }

  // Hint for next step
  lines.push('');
  if (featureName) {
    lines.push(`Next: canopytag query --feature ${featureName} --depth 5`);
  } else if (tagName) {
    lines.push(`Next: canopytag ls --tag ${tagName}`);
  } else {
    lines.push('Next: canopytag ls   or   canopytag stats --feature <name>');
  }

  // Hot files footer (top 3 by 7-day engagement)
  try {
    const analyticsPath = resolveAnalyticsPath(repoRoot);
    const analytics = readAnalytics(analyticsPath);
    const scored = Object.entries(analytics.files)
      .map(([p, fa]) => ({ p, score: engagementScore(fa, 7) }))
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (scored.length > 0) {
      lines.push('');
      lines.push('  hot files (7d)');
      for (const { p, score } of scored) {
        lines.push(`    ${p.padEnd(40)} ${score}`);
      }
    }
  } catch { /* analytics optional */ }

  return lines.join('\n');
}

function run() {
  const { values } = parseArgs({
    options: { ...CORE_OPTIONS, ...FILTER_OPTIONS },
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag stats — orient before you dive

Options:
  -r, --repo <path>      Repo root (default: cwd)
  -f, --feature <name>   Scope to feature
  -t, --tag <name>       Scope to tag
  -k, --kind <type>      Filter by file kind: doc, code, test, config, asset, data
      --unreviewed       Only files with unreviewed scores
      --after <date>     Files reviewed on or after ISO date
      --before <date>    Files reviewed on or before ISO date
  -h, --help             Show this help`);
    return;
  }

  const repoRoot = resolveRepoRoot(values.repo as string | undefined);
  const canopyPath = resolveCanopyPath(repoRoot);
  const canopy = readCanopy(canopyPath);

  let filters: FileFilters;
  try {
    filters = parseBaseFilters(values);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(buildStats(canopy, filters, repoRoot));
}

// Guard: don't run when imported as a module (e.g. in tests)
const isDirectRun = process.argv[1]?.endsWith('stats.ts') || process.argv[1]?.endsWith('stats.js');
if (isDirectRun) run();
