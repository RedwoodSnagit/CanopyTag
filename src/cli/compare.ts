#!/usr/bin/env node
/**
 * canopytag compare - compare authority, quality, and review signals for files
 *
 * Usage:
 *   canopytag compare docs/spec.md src/main.ts
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import { readCanopy } from '../backend/lib/canopy.js';
import { trackCanopyQueries } from '../backend/lib/analytics.js';
import type { Canopy, FileCanopy } from '../shared/types.js';
import {
  CORE_OPTIONS,
  aggregateScore,
  authorityScore,
  collectFreshnessPaths,
  fetchGitDates,
  freshnessLabel,
  getFreshnessStatus,
  highestTodoPriority,
  openTodoCount,
  resolveCanopyPath,
  resolveRepoRoot,
  truncate,
  warningCount,
} from './shared.js';

const DIMENSIONS = ['validity', 'clarity', 'completeness', 'stability'] as const;
type Dimension = typeof DIMENSIONS[number];

const AUTHORITY_LABELS: Record<string, string> = {
  standard: '5-Standard',
  specification: '4-Spec',
  guideline: '3-Guide',
  blueprint: '2-Blueprint',
  idea: '1-Idea',
};

export interface CompareResult {
  text: string;
  matchedPaths: string[];
}

interface CompareRow {
  filePath: string;
  fc: FileCanopy;
  authority: number;
  quality: number;
  scoredCount: number;
  warnings: number;
  todos: number;
  highestPriority: number;
  review: string;
}

function dimensionScore(fc: FileCanopy, dimension: Dimension): number | undefined {
  return fc[dimension];
}

function scoreCount(fc: FileCanopy): number {
  return DIMENSIONS.filter(dimension => dimensionScore(fc, dimension) != null).length;
}

function authorityLabel(fc: FileCanopy): string {
  return AUTHORITY_LABELS[fc.authorityLevel ?? ''] ?? '0-Unset';
}

function qualityLabel(row: CompareRow): string {
  if (row.scoredCount === 0) return '-';
  const suffix = row.scoredCount < DIMENSIONS.length ? ` (${row.scoredCount}/4)` : '';
  return `${row.quality}/20${suffix}`;
}

function todoLabel(row: CompareRow): string {
  if (row.todos === 0) return '-';
  const priority = row.highestPriority <= 5 ? ` P${row.highestPriority}` : '';
  return `${row.todos}${priority}`;
}

function dimensionsLabel(fc: FileCanopy): string {
  const parts = [
    ['valid', fc.validity],
    ['clear', fc.clarity],
    ['complete', fc.completeness],
    ['stable', fc.stability],
  ];
  return parts.map(([label, value]) => `${label}:${value ?? '-'}`).join(' ');
}

function makeRow(filePath: string, fc: FileCanopy, gitDates?: Map<string, string>): CompareRow {
  return {
    filePath,
    fc,
    authority: authorityScore(fc),
    quality: aggregateScore(fc),
    scoredCount: scoreCount(fc),
    warnings: warningCount(fc),
    todos: openTodoCount(fc),
    highestPriority: highestTodoPriority(fc),
    review: freshnessLabel(getFreshnessStatus(filePath, fc, gitDates)),
  };
}

function compareTrust(a: CompareRow, b: CompareRow): number {
  const authority = b.authority - a.authority;
  if (authority !== 0) return authority;

  const warnings = a.warnings - b.warnings;
  if (warnings !== 0) return warnings;

  const quality = b.quality - a.quality;
  if (quality !== 0) return quality;

  const todos = a.todos - b.todos;
  if (todos !== 0) return todos;

  return a.filePath.localeCompare(b.filePath);
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function normalizeRequestedPath(filePath: string, repoRoot?: string): string {
  const relativePath = repoRoot && path.isAbsolute(filePath)
    ? path.relative(repoRoot, filePath)
    : filePath;
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function buildCompare(canopy: Canopy, filePaths: string[], repoRoot?: string): CompareResult {
  const requested = [...new Set(filePaths.map(filePath => normalizeRequestedPath(filePath, repoRoot)))];
  if (requested.length === 0) {
    return { text: 'Usage: canopytag compare <file> [<file2> ...]', matchedPaths: [] };
  }

  const annotatedEntries = requested
    .map((filePath): [string, FileCanopy | undefined] => [filePath, canopy.files[filePath]])
    .filter((entry): entry is [string, FileCanopy] => entry[1] != null);
  const missing = requested.filter(filePath => canopy.files[filePath] == null);
  const gitDates = repoRoot && annotatedEntries.length > 0
    ? fetchGitDates(repoRoot, collectFreshnessPaths(annotatedEntries))
    : undefined;
  const rows = annotatedEntries.map(([filePath, fc]) => makeRow(filePath, fc, gitDates));

  if (rows.length === 0) {
    return {
      text: [
        'No requested files are annotated.',
        '',
        'Missing:',
        ...missing.map(filePath => `- ${filePath}`),
      ].join('\n'),
      matchedPaths: [],
    };
  }

  const renderedRows = rows.map(row => ({
    file: row.filePath,
    authority: authorityLabel(row.fc),
    quality: qualityLabel(row),
    review: row.review,
    status: row.fc.status ?? 'active',
    warnings: row.warnings > 0 ? String(row.warnings) : '-',
    todos: todoLabel(row),
    dimensions: dimensionsLabel(row.fc),
  }));

  const widths = {
    file: Math.max(4, ...renderedRows.map(row => row.file.length)),
    authority: Math.max(9, ...renderedRows.map(row => row.authority.length)),
    quality: Math.max(7, ...renderedRows.map(row => row.quality.length)),
    review: Math.max(6, ...renderedRows.map(row => row.review.length)),
    status: Math.max(6, ...renderedRows.map(row => row.status.length)),
    warnings: Math.max(4, ...renderedRows.map(row => row.warnings.length)),
    todos: Math.max(5, ...renderedRows.map(row => row.todos.length)),
  };

  const lines: string[] = [];
  lines.push(`Compared ${rows.length}/${requested.length} annotated file${requested.length !== 1 ? 's' : ''}.`);
  lines.push('Authority is conflict precedence. Quality is validity + clarity + completeness + stability out of 20.');
  lines.push('');

  const header = [
    pad('FILE', widths.file),
    pad('AUTHORITY', widths.authority),
    pad('QUALITY', widths.quality),
    pad('REVIEW', widths.review),
    pad('STATUS', widths.status),
    pad('WARN', widths.warnings),
    pad('TODOS', widths.todos),
    'DIMENSIONS',
  ].join('  ');
  lines.push(header);
  lines.push('-'.repeat(header.length));

  for (const row of renderedRows) {
    lines.push([
      pad(row.file, widths.file),
      pad(row.authority, widths.authority),
      pad(row.quality, widths.quality),
      pad(row.review, widths.review),
      pad(row.status, widths.status),
      pad(row.warnings, widths.warnings),
      pad(row.todos, widths.todos),
      row.dimensions,
    ].join('  '));
  }

  const trustOrder = [...rows].sort(compareTrust);
  lines.push('');
  lines.push('Trust order:');
  trustOrder.forEach((row, index) => {
    const flags = [
      row.warnings > 0 ? `${row.warnings} warning${row.warnings !== 1 ? 's' : ''}` : undefined,
      row.fc.scoresReviewed === false && row.scoredCount > 0 ? 'unreviewed scores' : undefined,
      row.review === 'Review Drift' ? 'review drift' : undefined,
    ].filter((value): value is string => Boolean(value));
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    lines.push(`${index + 1}. ${row.filePath} - ${authorityLabel(row.fc)}, quality ${qualityLabel(row)}${suffix}`);
  });

  const summaries = rows
    .filter(row => row.fc.summary)
    .map(row => `- ${row.filePath}: ${truncate(row.fc.summary ?? '', 100)}`);
  if (summaries.length > 0) {
    lines.push('');
    lines.push('Summaries:');
    lines.push(...summaries);
  }

  if (missing.length > 0) {
    lines.push('');
    lines.push('Not annotated:');
    lines.push(...missing.map(filePath => `- ${filePath}`));
  }

  return { text: lines.join('\n'), matchedPaths: rows.map(row => row.filePath) };
}

function run() {
  const { values, positionals } = parseArgs({
    options: { ...CORE_OPTIONS },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag compare - compare authority, quality, and review signals

Usage:
  canopytag compare <file> [<file2> ...]

Shows:
  - authority rank used for conflict precedence
  - quality composite out of 20
  - freshness/review status
  - warning and TODO pressure
  - trust order across the requested files

Options:
  -r, --repo <path>  Repo root (default: cwd)
  -h, --help         Show this help`);
    return;
  }

  if (positionals.length === 0) {
    console.error('Usage: canopytag compare <file> [<file2> ...]');
    process.exit(1);
  }

  const repoRoot = resolveRepoRoot(values.repo as string | undefined);
  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const canopy = readCanopy(canopyPath);
  const result = buildCompare(canopy, positionals, repoRoot);
  if (result.matchedPaths.length > 0) {
    trackCanopyQueries(repoRoot, result.matchedPaths);
  }
  console.log(result.text);
}

const isDirectRun = process.argv[1]?.endsWith('compare.ts') || process.argv[1]?.endsWith('compare.js');
if (isDirectRun) run();
