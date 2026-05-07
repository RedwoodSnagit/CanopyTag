/**
 * canopytag coverage — annotation coverage report
 *
 * Shows how many repo files are annotated, which aren't, and flags
 * orphaned annotations pointing at files that no longer exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import ignore from 'ignore';
import { readCanopy } from '../backend/lib/canopy.js';
import {
  resolveRepoRoot, resolveCanopyPath, fileKind,
  CORE_OPTIONS, FILTER_OPTIONS,
} from './shared.js';
import type { Canopy, FileCanopy, FileKind } from '../shared/types.js';

// ---- Types ----

export interface FieldCoverage {
  path: string;
  has: string[];
  missing: string[];
}

export interface CoverageResult {
  total: number;
  annotated: number;
  unannotated: number;
  orphaned: number;
  orphanedFiles: string[];
  byKind: Record<string, { annotated: number; unannotated: number }>;
  fieldCoverage?: FieldCoverage[];
}

export interface BuildCoverageResult {
  text: string;
  result: CoverageResult;
}

// ---- File Discovery ----

/**
 * Discover all files in a git repo that are candidates for annotation.
 * Uses `git ls-files` (respects .gitignore) + .ctagignore filtering.
 * Excludes files under the canopy directory itself.
 */
export function discoverRepoFiles(repoRoot: string, canopyDir: string): Set<string> {
  let output: string;
  try {
    output = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('canopytag coverage requires a git repository');
  }

  const files = output.trim().split('\n').filter(Boolean);

  // Normalize to forward slashes
  const normalized = files.map(f => f.replace(/\\/g, '/'));

  // Exclude canopy directory files
  const canopyRel = path.relative(repoRoot, canopyDir).replace(/\\/g, '/');
  const canopyPrefix = canopyRel + '/';
  let filtered = normalized.filter(f => !f.startsWith(canopyPrefix));

  // Apply .ctagignore if found
  const ig = loadCtagignore(repoRoot);
  if (ig) {
    filtered = filtered.filter(f => !ig.ignores(f));
  }

  return new Set(filtered);
}

function loadCtagignore(repoRoot: string): ReturnType<typeof ignore> | null {
  const candidates = [
    path.join(repoRoot, 'canopytag', '.ctagignore'),
    path.join(repoRoot, '.ctagignore'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const ig = ignore();
      ig.add(fs.readFileSync(p, 'utf-8'));
      return ig;
    }
  }
  return null;
}

// ---- Coverage Computation ----

const FIELD_CHECKS: { name: string; check: (fc: FileCanopy) => boolean }[] = [
  { name: 'summary', check: fc => typeof fc.summary === 'string' && fc.summary.length > 0 },
  { name: 'tags', check: fc => Array.isArray(fc.tags) && fc.tags.length > 0 },
  { name: 'scores', check: fc => fc.validity != null || fc.clarity != null || fc.completeness != null || fc.stability != null },
  { name: 'authority', check: fc => fc.authorityLevel != null },
  { name: 'relations', check: fc => Array.isArray(fc.relatedFiles) && fc.relatedFiles.length > 0 },
];

function checkFields(fc: FileCanopy): FieldCoverage & { _hasCount: number } {
  const has: string[] = [];
  const missing: string[] = [];
  for (const { name, check } of FIELD_CHECKS) {
    if (check(fc)) has.push(name);
    else missing.push(name);
  }
  return { path: '', has, missing, _hasCount: has.length };
}

export function buildCoverage(
  canopy: Canopy,
  repoFiles: Set<string>,
  kind?: FileKind | string,
  detail?: boolean,
): BuildCoverageResult {
  const canopyKeys = new Set(Object.keys(canopy.files));

  // Orphans: in canopy but not on disk (always unfiltered)
  const orphanedFiles = [...canopyKeys].filter(k => !repoFiles.has(k)).sort();

  // Apply kind filter to repo files if specified
  let filteredRepo = [...repoFiles];
  if (kind) {
    filteredRepo = filteredRepo.filter(f => fileKind(f) === kind);
  }

  // Annotated = in canopy AND in filtered repo set
  const annotatedInFiltered = filteredRepo.filter(f => canopyKeys.has(f));
  const annotatedSet = new Set(annotatedInFiltered);
  const unannotatedInFiltered = filteredRepo.filter(f => !canopyKeys.has(f));

  // By-kind breakdown
  const byKind: Record<string, { annotated: number; unannotated: number }> = {};
  for (const f of filteredRepo) {
    const k = fileKind(f);
    if (!byKind[k]) byKind[k] = { annotated: 0, unannotated: 0 };
    if (annotatedSet.has(f)) byKind[k].annotated++;
    else if (!canopyKeys.has(f)) byKind[k].unannotated++;
  }

  // Field coverage (detail mode)
  let fieldCoverage: FieldCoverage[] | undefined;
  const canopyEntries = Object.entries(canopy.files).filter(([k]) => annotatedSet.has(k));
  if (detail) {
    fieldCoverage = canopyEntries
      .map(([filePath, fc]) => {
        const check = checkFields(fc);
        return { path: filePath, has: check.has, missing: check.missing, _hasCount: check._hasCount };
      })
      .sort((a, b) => a._hasCount - b._hasCount)
      .map(({ _hasCount, ...rest }) => rest);
  }

  const result: CoverageResult = {
    total: filteredRepo.length,
    annotated: annotatedInFiltered.length,
    unannotated: unannotatedInFiltered.length,
    orphaned: orphanedFiles.length,
    orphanedFiles,
    byKind,
    fieldCoverage,
  };

  const text = renderCoverageText(result, detail);
  return { text, result };
}

function renderCoverageText(r: CoverageResult, detail?: boolean): string {
  const lines: string[] = [];
  const pct = r.total > 0 ? Math.round((r.annotated / r.total) * 100) : 0;
  lines.push(`Coverage: ${r.annotated}/${r.total} files annotated (${pct}%)`);

  // Unannotated by kind
  const unannotatedKinds = Object.entries(r.byKind)
    .filter(([, v]) => v.unannotated > 0)
    .sort((a, b) => b[1].unannotated - a[1].unannotated);
  if (unannotatedKinds.length > 0) {
    lines.push('');
    lines.push('  Unannotated by kind:');
    for (const [kind, counts] of unannotatedKinds) {
      lines.push(`    ${kind.padEnd(10)} ${counts.unannotated}`);
    }
  }

  // Orphans
  if (r.orphanedFiles.length > 0) {
    lines.push('');
    lines.push(`  Orphaned (${r.orphanedFiles.length}):`);
    for (const f of r.orphanedFiles) {
      lines.push(`    ${f}`);
    }
  }

  // Detail mode
  if (detail && r.fieldCoverage && r.fieldCoverage.length > 0) {
    lines.push('');
    lines.push('  Annotation depth (least complete first):');
    for (const fc of r.fieldCoverage) {
      const hasStr = fc.has.length > 0 ? fc.has.join(', ') : '(none)';
      const missingStr = fc.missing.length > 0 ? `missing: ${fc.missing.join(', ')}` : 'complete';
      lines.push(`    ${fc.path.padEnd(30)} ${hasStr.padEnd(30)} ${missingStr}`);
    }
  }

  return lines.join('\n');
}

// ---- CLI entrypoint ----

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').match(/cli\/coverage\.[tj]s$/);
if (isDirectRun) {

const { values } = parseArgs({
  options: {
    ...CORE_OPTIONS,
    ...FILTER_OPTIONS,
    detail: { type: 'boolean' },
    sort: { type: 'string', short: 's' },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`canopytag coverage — annotation coverage report

Usage:
  canopytag coverage [--repo <path>] [--detail] [--kind <type>]

Options:
  --repo, -r      Path to the target repo (default: current directory)
  --kind, -k      Filter by file kind: doc, code, test, config, asset, data
  --detail        Show per-file field completeness for annotated files
  --sort name     Alphabetical listing of unannotated files
  --help, -h      Show this help

Shows how many repo files are annotated, which aren't, and flags
orphaned annotations pointing at files that no longer exist.
`);
  process.exit(0);
}

const repoRoot = resolveRepoRoot(values.repo as string | undefined);
const canopyPath = resolveCanopyPath(values.repo as string | undefined);
const canopyDir = path.dirname(canopyPath);
const canopy = readCanopy(canopyPath);
const repoFiles = discoverRepoFiles(repoRoot, canopyDir);
const kind = values.kind as string | undefined;
const detail = values.detail as boolean | undefined;

const { text } = buildCoverage(canopy, repoFiles, kind, detail ?? false);
process.stdout.write(text + '\n');

} // end isDirectRun
