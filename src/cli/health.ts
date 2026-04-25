#!/usr/bin/env node
/**
 * canopytag health — authority vs quality score health check
 *
 * Surfaces mismatches: specs that are unclear, ideas ready for promotion,
 * unscored files that need attention.
 *
 * Usage:
 *   canopytag health                     # show all mismatches
 *   canopytag health --all               # include healthy files too
 *   canopytag health --repo /path        # specify repo
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import { checkAuthorityHealth } from '../shared/types.js';
import type { Canopy, AuthorityHealth } from '../shared/types.js';
import {
  resolveCanopyPath,
  CORE_OPTIONS, FILTER_OPTIONS,
  parseBaseFilters, filterFiles,
  type FileFilters,
} from './shared.js';

function statusIcon(status: AuthorityHealth['status']): string {
  switch (status) {
    case 'healthy': return '  ';
    case 'underscored': return '!!';
    case 'promotion-candidate': return '^^';
    case 'unscored': return '??';
  }
}

export function buildHealth(canopy: Canopy, filters: FileFilters, showAll: boolean, repoRoot?: string): string {
  const lines: string[] = [];
  const entries = filterFiles(Object.entries(canopy.files), filters);

  const results: { file: string; health: AuthorityHealth }[] = [];

  for (const [filePath, fc] of entries) {
    const health = checkAuthorityHealth(fc);
    if (!health) continue;  // no authority level set
    if (!showAll && health.status === 'healthy') continue;
    results.push({ file: filePath, health });
  }

  if (results.length === 0) {
    return 'All annotated files with authority levels are healthy.';
  }

  // Sort: problems first (underscored, then promotion candidates, then unscored, then healthy)
  const statusOrder: Record<string, number> = { underscored: 0, 'promotion-candidate': 1, unscored: 2, healthy: 3 };
  results.sort((a, b) => (statusOrder[a.health.status] ?? 9) - (statusOrder[b.health.status] ?? 9));

  const fileCol = Math.max(4, ...results.map(r => r.file.length));

  lines.push(`${''.padEnd(2)}  ${'FILE'.padEnd(fileCol)}  AUTH           SCORE  EXPECTED`);
  lines.push('-'.repeat(2 + 2 + fileCol + 2 + 13 + 2 + 5 + 2 + 8));

  for (const { file, health } of results) {
    const icon = statusIcon(health.status);
    const scoreStr = health.status === 'unscored' ? '  -' : String(health.aggregate).padStart(3);
    const rangeStr = `${health.expectedRange[0]}-${health.expectedRange[1]}`;
    lines.push(
      `${icon}  ${file.padEnd(fileCol)}  ${health.authorityLevel.padEnd(13)}  ${scoreStr}  ${rangeStr}`
    );
  }

  // Summary
  const counts = { underscored: 0, 'promotion-candidate': 0, unscored: 0, healthy: 0 };
  for (const { health } of results) counts[health.status]++;
  const parts: string[] = [];
  if (counts.underscored > 0) parts.push(`${counts.underscored} underscored`);
  if (counts['promotion-candidate'] > 0) parts.push(`${counts['promotion-candidate']} promotion candidates`);
  if (counts.unscored > 0) parts.push(`${counts.unscored} unscored`);
  if (parts.length > 0) lines.push(`\n${parts.join(', ')}`);

  return lines.join('\n');
}

function run() {
  const { values } = parseArgs({
    options: {
      ...CORE_OPTIONS, ...FILTER_OPTIONS,
      all: { type: 'boolean', short: 'a' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag health — authority vs quality health check

Shows files where declared authority doesn't match quality scores.
  !! = underscored (spec-level file with low quality — needs fortifying)
  ^^ = promotion candidate (high quality for its authority level)
  ?? = unscored (has authority but no quality scores yet)

Options:
  -r, --repo <path>      Repo root (default: cwd)
  -f, --feature <name>   Filter by feature ID
  -t, --tag <name>       Filter by tag
  -k, --kind <type>      Filter by file kind: doc, code, test, config, asset, data
      --unreviewed       Only files with unreviewed scores
      --after <date>     Files reviewed on or after ISO date
      --before <date>    Files reviewed on or before ISO date
  -a, --all              Include healthy files too
  -h, --help             Show this help`);
    return;
  }

  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const canopy = readCanopy(canopyPath);

  let filters: FileFilters;
  try {
    filters = parseBaseFilters(values);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(buildHealth(canopy, filters, !!(values.all as boolean)));
}

// Guard: don't run when imported as a module (e.g. in tests)
const isDirectRun = process.argv[1]?.endsWith('health.ts') || process.argv[1]?.endsWith('health.js');
if (isDirectRun) run();
