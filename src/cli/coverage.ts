/**
 * canopytag coverage — purposeful authored scope coverage
 *
 * Leads with named authored file/directory scope sets, keeps generated provider
 * proposals separate, and retains neutral tracked-file inventory/orphan checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import ignore from 'ignore';
import { readCanopy } from '../backend/lib/canopy.js';
import {
  readScopeMembershipProposalArtifact,
  resolveScopeMembershipProposalPath,
  scopeProposalFreshness,
} from '../backend/lib/scope-proposals.js';
import {
  resolveRepoRoot, resolveCanopyPath, fileKind,
  CORE_OPTIONS, FILTER_OPTIONS,
} from './shared.js';
import type {
  Canopy,
  FileCanopy,
  FileKind,
  ScopeMembershipProposal,
  ScopeMembershipProposalArtifact,
  ScopeSet,
  ScopeSetMember,
  ScopeSubjectKind,
} from '../shared/types.js';

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
  scopeCoverage: ScopeCoverageResult[];
}

export interface BuildCoverageResult {
  text: string;
  result: CoverageResult;
}

export interface ScopeSubjectCounts {
  total: number;
  annotated: number;
  unannotated: number;
  missing: number;
}

export interface ScopeMemberCoverage extends ScopeSetMember {
  exists: boolean;
  annotated: boolean;
  metadataPresent: boolean;
  actualKind?: ScopeSubjectKind;
}

export interface ScopeProposalSource {
  provider: string;
  artifactFingerprint: string;
  generatedAt: string;
  freshUntil: string;
  freshness: 'fresh' | 'stale';
  proposals: ScopeMembershipProposal[];
}

export interface ScopeCoverageResult extends ScopeSubjectCounts {
  id: string;
  name: string;
  description?: string;
  files: ScopeSubjectCounts;
  directories: ScopeSubjectCounts;
  members: ScopeMemberCoverage[];
  proposalSources: ScopeProposalSource[];
  proposalCount: number;
}

export interface CoverageOptions {
  kind?: FileKind | string;
  detail?: boolean;
  scope?: string;
  pathKind?: (relativePath: string) => ScopeSubjectKind | undefined;
  proposalArtifacts?: ScopeMembershipProposalArtifact[];
  asOf?: Date;
}

// ---- File Discovery ----

/** Discover every tracked file in a Git repo, normalized to forward slashes. */
export function discoverTrackedFiles(repoRoot: string): Set<string> {
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

  return new Set(output.trim().split('\n').filter(Boolean).map(f => f.replace(/\\/g, '/')));
}

/**
 * Discover tracked files that are candidates for annotation.
 * Applies .ctagignore and excludes files under the canopy directory itself.
 */
export function discoverRepoFiles(repoRoot: string, canopyDir: string): Set<string> {
  const normalized = [...discoverTrackedFiles(repoRoot)];

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

/** Resolve a safe repository-relative subject to its current filesystem kind. */
export function resolveRepoPathKind(
  repoRoot: string,
  relativePath: string,
): ScopeSubjectKind | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.split('/').includes('..') ||
      path.posix.isAbsolute(normalized) || path.win32.isAbsolute(relativePath)) {
    return undefined;
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, ...normalized.split('/'));
  const fromRoot = path.relative(root, resolved);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return undefined;
  try {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
  } catch {
    // Missing and unreadable subjects are both unresolved coverage targets.
  }
  return undefined;
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
  options: CoverageOptions = {},
): BuildCoverageResult {
  const { kind, detail, scope, pathKind, proposalArtifacts = [], asOf = new Date() } = options;
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
  const scopeCoverage = buildScopeCoverage(
    canopy,
    repoFiles,
    scope,
    pathKind,
    proposalArtifacts,
    asOf,
  );
  const selectedScopeFiles = scope
    ? new Set(scopeCoverage.flatMap(item => item.members)
      .filter(member => member.kind === 'file' && member.annotated)
      .map(member => member.path))
    : annotatedSet;
  const canopyEntries = Object.entries(canopy.files).filter(([k]) => selectedScopeFiles.has(k));
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
    scopeCoverage,
  };

  const text = renderCoverageText(result, detail, scope);
  return { text, result };
}

function emptyScopeCounts(): ScopeSubjectCounts {
  return { total: 0, annotated: 0, unannotated: 0, missing: 0 };
}

function countScopeMembers(members: ScopeMemberCoverage[]): ScopeSubjectCounts {
  const counts = emptyScopeCounts();
  for (const member of members) {
    counts.total += 1;
    if (member.annotated) counts.annotated += 1;
    else if (!member.exists) counts.missing += 1;
    else counts.unannotated += 1;
  }
  return counts;
}

function buildOneScopeCoverage(
  id: string,
  scopeSet: ScopeSet,
  canopy: Canopy,
  repoFiles: Set<string>,
  pathKind: CoverageOptions['pathKind'],
  artifacts: ScopeMembershipProposalArtifact[],
  asOf: Date,
): ScopeCoverageResult {
  const seen = new Set<string>();
  const members: ScopeMemberCoverage[] = [];
  for (const member of scopeSet.members ?? []) {
    const normalizedPath = member.path.replace(/\\/g, '/');
    const identity = normalizedPath;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const actualKind = pathKind?.(normalizedPath)
      ?? (repoFiles.has(normalizedPath) ? 'file' : undefined);
    const exists = actualKind === member.kind;
    const metadataPresent = member.kind === 'file'
      ? Object.prototype.hasOwnProperty.call(canopy.files, normalizedPath)
      : Object.prototype.hasOwnProperty.call(canopy.directories ?? {}, normalizedPath);
    members.push({
      ...member,
      path: normalizedPath,
      exists,
      annotated: exists && metadataPresent,
      metadataPresent,
      actualKind,
    });
  }
  members.sort((a, b) => a.path.localeCompare(b.path));

  const authored = new Set(members.map(member => `${member.kind}:${member.path}`));
  const proposalSources = artifacts
    .map(artifact => ({
      provider: artifact.provider,
      artifactFingerprint: artifact.artifactFingerprint,
      generatedAt: artifact.generatedAt,
      freshUntil: artifact.freshUntil,
      freshness: scopeProposalFreshness(artifact, asOf),
      proposals: artifact.proposals
        .filter(proposal => proposal.scopeSetId === id)
        .filter(proposal => !authored.has(`${proposal.kind}:${proposal.path.replace(/\\/g, '/')}`))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .filter(source => source.proposals.length > 0);

  const counts = countScopeMembers(members);
  const files = countScopeMembers(members.filter(member => member.kind === 'file'));
  const directories = countScopeMembers(members.filter(member => member.kind === 'directory'));
  return {
    id,
    name: scopeSet.name,
    description: scopeSet.description,
    ...counts,
    files,
    directories,
    members,
    proposalSources,
    proposalCount: proposalSources.reduce((total, source) => total + source.proposals.length, 0),
  };
}

function buildScopeCoverage(
  canopy: Canopy,
  repoFiles: Set<string>,
  requestedScope: string | undefined,
  pathKind: CoverageOptions['pathKind'],
  artifacts: ScopeMembershipProposalArtifact[],
  asOf: Date,
): ScopeCoverageResult[] {
  const entries = Object.entries(canopy.scopeSets ?? {});
  const selected = requestedScope
    ? entries.filter(([id]) => id === requestedScope)
    : entries;
  if (requestedScope && selected.length === 0) {
    const available = entries.map(([id]) => id).sort();
    throw new Error(`Unknown scope set "${requestedScope}".${available.length > 0 ? ` Available: ${available.join(', ')}` : ' No authored scope sets are defined.'}`);
  }
  return selected
    .map(([id, scopeSet]) => buildOneScopeCoverage(
      id,
      scopeSet,
      canopy,
      repoFiles,
      pathKind,
      artifacts,
      asOf,
    ))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function renderScopeSummary(scope: ScopeCoverageResult): string {
  const pct = scope.total > 0 ? Math.round((scope.annotated / scope.total) * 100) : 0;
  const proposals = scope.proposalCount > 0 ? ` · ${scope.proposalCount} generated proposal${scope.proposalCount === 1 ? '' : 's'} (not counted)` : '';
  const missing = scope.missing > 0 ? ` · ${scope.missing} missing/wrong kind` : '';
  return `  ${scope.id.padEnd(24)} ${scope.annotated}/${scope.total} targets annotated (${pct}%) · files ${scope.files.annotated}/${scope.files.total} · directories ${scope.directories.annotated}/${scope.directories.total}${missing}${proposals}`;
}

function renderSelectedScope(scope: ScopeCoverageResult): string[] {
  const pct = scope.total > 0 ? Math.round((scope.annotated / scope.total) * 100) : 0;
  const lines = [
    `Scope: ${scope.id} — ${scope.name}`,
    ...(scope.description ? [`Purpose: ${scope.description}`] : []),
    `Coverage: ${scope.annotated}/${scope.total} authored targets annotated (${pct}%)`,
    `  Files: ${scope.files.annotated}/${scope.files.total} annotated`,
    `  Directories: ${scope.directories.annotated}/${scope.directories.total} annotated`,
  ];
  const unannotated = scope.members.filter(member => member.exists && !member.annotated);
  if (unannotated.length > 0) {
    lines.push('', `  Unannotated authored targets (${unannotated.length}):`);
    for (const member of unannotated) {
      lines.push(`    ${member.path} [${member.kind}${member.role ? `/${member.role}` : ''}]`);
    }
  }
  const missing = scope.members.filter(member => !member.exists);
  if (missing.length > 0) {
    lines.push('', `  Missing or wrong-kind targets (${missing.length}):`);
    for (const member of missing) {
      const found = member.actualKind ? `; found ${member.actualKind}` : '';
      lines.push(`    ${member.path} [expected ${member.kind}${found}]`);
    }
  }
  if (scope.proposalSources.length > 0) {
    lines.push('', `  Generated membership proposals (${scope.proposalCount}; not counted):`);
    for (const source of scope.proposalSources) {
      lines.push(`    ${source.provider} · ${source.freshness} through ${source.freshUntil} · ${source.artifactFingerprint}`);
      for (const proposal of source.proposals) {
        const rationale = proposal.rationale ? ` — ${proposal.rationale}` : '';
        lines.push(`      + ${proposal.path} [${proposal.kind}${proposal.role ? `/${proposal.role}` : ''}]${rationale}`);
      }
    }
  }
  return lines;
}

function renderCoverageText(r: CoverageResult, detail?: boolean, selectedScope?: string): string {
  const lines: string[] = [];
  const pct = r.total > 0 ? Math.round((r.annotated / r.total) * 100) : 0;
  if (selectedScope && r.scopeCoverage[0]) {
    lines.push(...renderSelectedScope(r.scopeCoverage[0]), '');
    lines.push(`Whole-repo inventory (informational): ${r.annotated}/${r.total} tracked files annotated (${pct}%)`);
  } else if (r.scopeCoverage.length > 0) {
    lines.push('Authored scope coverage:');
    for (const scope of r.scopeCoverage) lines.push(renderScopeSummary(scope));
    lines.push('', `Whole-repo inventory (informational): ${r.annotated}/${r.total} tracked files annotated (${pct}%)`);
  } else {
    lines.push(`Coverage: ${r.annotated}/${r.total} files annotated (${pct}%)`);
  }

  // Unannotated by kind
  const unannotatedKinds = Object.entries(r.byKind)
    .filter(([, v]) => v.unannotated > 0)
    .sort((a, b) => b[1].unannotated - a[1].unannotated);
  if (!selectedScope && r.scopeCoverage.length === 0 && unannotatedKinds.length > 0) {
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
    scope: { type: 'string' },
    sort: { type: 'string', short: 's' },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`canopytag coverage — annotation coverage report

Usage:
  canopytag coverage [--repo <path>] [--scope <id>] [--detail] [--kind <type>]

Options:
  --repo, -r      Path to the target repo (default: current directory)
  --kind, -k      Filter by file kind: doc, code, test, config, asset, data
  --scope         Report one authored scope set and its gaps
  --detail        Show per-file field completeness for annotated files
  --sort name     Alphabetical listing of unannotated files
  --help, -h      Show this help

Reports authored scope coverage when scope_sets are present. Whole-repository
annotation remains an informational inventory statistic. Optional generated
proposals are read from canopytag/generated/scope-membership.json, shown with
provenance and freshness, and never counted as authored members.
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
const scope = values.scope as string | undefined;
const proposal = readScopeMembershipProposalArtifact(resolveScopeMembershipProposalPath(canopyPath));

const { text } = buildCoverage(canopy, repoFiles, {
  kind,
  detail: detail ?? false,
  scope,
  pathKind: relativePath => resolveRepoPathKind(repoRoot, relativePath),
  proposalArtifacts: proposal ? [proposal] : [],
});
process.stdout.write(text + '\n');

} // end isDirectRun
