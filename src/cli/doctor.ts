#!/usr/bin/env node
/**
 * canopytag doctor — deterministic maintenance checks
 *
 * This command deliberately checks only facts CanopyTag can establish without
 * inventing semantic metadata: path safety/existence, identifier collisions,
 * Git-backed review drift, orphaned cards, and pending agent review work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readAgentManifest, resolveAgentManifestPathFromCanopyPath } from '../backend/lib/agent-manifest.js';
import { readCanopy } from '../backend/lib/canopy.js';
import { getLastModifiedBatch } from '../backend/lib/git-info.js';
import type { Canopy, FileCanopy, FileRelation, RelatedFileEntry } from '../shared/types.js';
import { checkFreshness, isUnattributedAgent, normalizeRelation } from '../shared/types.js';
import { discoverTrackedFiles } from './coverage.js';
import {
  resolveCanopyPath,
  resolveRepoRoot,
  CORE_OPTIONS,
} from './shared.js';

export type DoctorSeverity = 'error' | 'warning' | 'info';

export interface DoctorIssue {
  severity: DoctorSeverity;
  code: string;
  message: string;
  path?: string;
  suggestion?: string;
}

export interface DoctorCounts {
  errors: number;
  warnings: number;
  info: number;
}

export interface DoctorReport {
  ok: boolean;
  strictOk: boolean;
  counts: DoctorCounts;
  /**
   * Full finding counts per code, computed before any truncation. A limit
   * bounds how much detail is rendered; it must never hide that a class of
   * finding exists at all.
   */
  countsByCode: Record<string, number>;
  totalIssues: number;
  checked: {
    annotations: number;
    features: number;
    trackedFiles: number;
  };
  issues: DoctorIssue[];
  omittedIssues: number;
}

export interface DoctorEvidence {
  repoFiles: Set<string>;
  gitDates?: Map<string, string>;
  pendingAgentReviews?: number;
  manifestError?: string;
  pathExists?: (relativePath: string) => boolean;
  pathKind?: (relativePath: string) => 'file' | 'directory' | undefined;
  issueLimit?: number;
}

const DEFAULT_ISSUE_LIMIT = 50;
const MAX_ISSUE_LIMIT = 500;
const SEVERITY_ORDER: Record<DoctorSeverity, number> = { error: 0, warning: 1, info: 2 };

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function unsafePathReason(value: string): string | undefined {
  const normalized = normalizeRepoPath(value);
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)) {
    return 'absolute path';
  }
  if (normalized.split('/').includes('..')) {
    return 'parent-directory traversal';
  }
  if (normalized.length === 0 || normalized === '.') {
    return 'empty or repository-root path';
  }
  return undefined;
}

function clampIssueLimit(value?: number): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_ISSUE_LIMIT;
  return Math.max(1, Math.min(MAX_ISSUE_LIMIT, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRelations(card: Record<string, unknown>): FileRelation[] {
  if (!Array.isArray(card.relatedFiles)) return [];
  return card.relatedFiles
    .filter((entry): entry is RelatedFileEntry => (
      typeof entry === 'string'
      || (isRecord(entry) && typeof entry.path === 'string')
    ))
    .map(normalizeRelation);
}

function collectDoctorFreshnessPaths(files: Record<string, FileCanopy>): string[] {
  const paths = new Set<string>();
  for (const [filePath, rawCard] of Object.entries(files)) {
    if (!isRecord(rawCard) || typeof rawCard.lastReviewed !== 'string') continue;
    paths.add(filePath);
    for (const relation of validRelations(rawCard)) {
      if ((relation.closeness ?? 3) >= 4 && !unsafePathReason(relation.path)) {
        paths.add(normalizeRepoPath(relation.path));
      }
    }
  }
  return [...paths];
}

function collectDuplicateIds(
  files: Record<string, FileCanopy>,
  kind: 'todo' | 'comment',
): Map<string, string[]> {
  const occurrences = new Map<string, string[]>();
  for (const [filePath, rawCard] of Object.entries(files)) {
    if (!isRecord(rawCard)) continue;
    const candidate = kind === 'todo' ? rawCard.todos : rawCard.comments;
    const items = Array.isArray(candidate) ? candidate : [];
    for (const item of items) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue;
      const id = item.id;
      const locations = occurrences.get(id) ?? [];
      locations.push(filePath);
      occurrences.set(id, locations);
    }
  }
  return new Map([...occurrences].filter(([, locations]) => locations.length > 1));
}

/** Pure inspection layer, separated from Git and filesystem discovery for tests and reuse. */
export function inspectCanopyDoctor(canopy: Canopy, evidence: DoctorEvidence): DoctorReport {
  const allIssues: DoctorIssue[] = [];
  const exists = evidence.pathExists ?? ((relativePath: string) => evidence.repoFiles.has(relativePath));
  const add = (issue: DoctorIssue) => allIssues.push(issue);

  if (canopy.repoRoot != null && typeof canopy.repoRoot !== 'string') {
    add({
      severity: 'error',
      code: 'invalid-repo-root',
      message: 'repo_root must be a string.',
      suggestion: 'Use an empty string for portable shared metadata.',
    });
  } else if (canopy.repoRoot) {
    const normalizedRoot = normalizeRepoPath(canopy.repoRoot);
    const rootIsUnsafe = path.posix.isAbsolute(normalizedRoot)
      || path.win32.isAbsolute(canopy.repoRoot)
      || normalizedRoot.split('/').includes('..');
    add({
      severity: rootIsUnsafe ? 'warning' : 'info',
      code: 'persisted-repo-root',
      message: rootIsUnsafe
        ? 'repo_root contains a machine-specific or parent-traversing path.'
        : 'repo_root is persisted; new portable canopies leave this field blank.',
      suggestion: 'Set repo_root to an empty string; pass --repo or REPO_ROOT at runtime.',
    });
  }

  for (const [filePath, rawCard] of Object.entries(canopy.files)) {
    const normalizedFile = normalizeRepoPath(filePath);
    const filePathProblem = unsafePathReason(filePath);
    if (filePathProblem) {
      add({
        severity: 'error',
        code: 'unsafe-annotation-path',
        path: filePath,
        message: `Annotation key uses an unsafe ${filePathProblem}.`,
        suggestion: 'Rename the card to a repository-relative file path.',
      });
    } else if (!evidence.repoFiles.has(normalizedFile)) {
      const localKind = evidence.pathKind?.(normalizedFile)
        ?? (exists(normalizedFile) ? 'file' : undefined);
      add({
        severity: 'warning',
        code: localKind === 'directory'
          ? 'directory-annotation'
          : localKind === 'file' ? 'untracked-annotation' : 'orphaned-annotation',
        path: filePath,
        message: localKind === 'directory'
          ? 'A file annotation card points to a directory.'
          : localKind === 'file'
            ? 'Annotation points to a file that exists locally but is not tracked in Git.'
            : 'Annotation points to a file that no longer exists in the repository.',
        suggestion: localKind === 'directory'
          ? 'Confirm this compatibility pattern; prefer directories metadata or annotated entrypoint files when practical.'
          : localKind === 'file'
            ? 'Commit the file with its card, or remove the annotation if the file is intentionally local.'
            : 'Confirm a rename/deletion, then move or remove the stale card intentionally.',
      });
    }

    if (!isRecord(rawCard)) {
      add({
        severity: 'error',
        code: 'invalid-file-card',
        path: filePath,
        message: 'File annotation must be an object.',
        suggestion: 'Restore the card object or remove the malformed entry intentionally.',
      });
      continue;
    }
    const card = rawCard as FileCanopy;

    if (rawCard.relatedFiles !== undefined && !Array.isArray(rawCard.relatedFiles)) {
      add({
        severity: 'error',
        code: 'invalid-related-files',
        path: filePath,
        message: 'related_files must be an array.',
        suggestion: 'Use strings or objects with a repository-relative path.',
      });
    }
    const rawRelations = Array.isArray(rawCard.relatedFiles) ? rawCard.relatedFiles : [];
    for (const [index, entry] of rawRelations.entries()) {
      if (typeof entry !== 'string' && (!isRecord(entry) || typeof entry.path !== 'string')) {
        add({
          severity: 'error',
          code: 'invalid-related-entry',
          path: filePath,
          message: `related_files[${index}] must be a path string or an object with a string path.`,
          suggestion: 'Repair or remove the malformed relationship entry.',
        });
      }
    }
    const relations = validRelations(rawCard);
    for (const relation of relations) {
      const target = normalizeRepoPath(relation.path ?? '');
      const relationProblem = unsafePathReason(relation.path ?? '');
      if (relationProblem) {
        add({
          severity: 'error',
          code: 'unsafe-related-path',
          path: filePath,
          message: `Related-file target "${relation.path ?? ''}" uses an unsafe ${relationProblem}.`,
          suggestion: 'Use a repository-relative file path.',
        });
      } else if (!exists(target)) {
        add({
          severity: 'warning',
          code: 'missing-related-file',
          path: filePath,
          message: `Related-file target "${target}" does not exist.`,
          suggestion: `Update or remove the relationship, then run canopytag context ${filePath}.`,
        });
      }
    }

    if (rawCard.lastReviewed !== undefined && typeof rawCard.lastReviewed !== 'string') {
      add({
        severity: 'error',
        code: 'invalid-last-reviewed',
        path: filePath,
        message: 'last_reviewed must be an ISO date string.',
        suggestion: 'Repair the date or remove it until the card is reviewed.',
      });
    } else if (evidence.gitDates && typeof card.lastReviewed === 'string') {
      const relatedModifiedDates = relations
        .filter(relation => (relation.closeness ?? 3) >= 4)
        .map(relation => evidence.gitDates?.get(normalizeRepoPath(relation.path)))
        .filter((value): value is string => typeof value === 'string');
      const freshness = checkFreshness({
        lastModified: evidence.gitDates.get(normalizedFile),
        lastReviewed: card.lastReviewed,
        relatedModifiedDates,
      });
      if (freshness === 'review-drift') {
        add({
          severity: 'warning',
          code: 'review-drift',
          path: filePath,
          message: 'The file or a close related file changed after this card was last reviewed.',
          suggestion: `Review with canopytag context ${filePath}, then update last_reviewed if the card is still accurate.`,
        });
      }
    }

    for (const field of ['todos', 'comments'] as const) {
      const value = rawCard[field];
      if (value !== undefined && !Array.isArray(value)) {
        add({
          severity: 'error',
          code: `invalid-${field}`,
          path: filePath,
          message: `${field} must be an array.`,
          suggestion: `Repair the malformed ${field} collection before using write or review tools.`,
        });
      }
    }
  }

  for (const [featureId, rawFeature] of Object.entries(canopy.features)) {
    if (!isRecord(rawFeature)) {
      add({
        severity: 'error',
        code: 'invalid-feature-card',
        path: featureId,
        message: 'Feature metadata must be an object.',
        suggestion: 'Restore the feature card object or remove the malformed entry intentionally.',
      });
      continue;
    }
    if (rawFeature.canonicalFile === undefined) continue;
    if (typeof rawFeature.canonicalFile !== 'string') {
      add({
        severity: 'error',
        code: 'invalid-canonical-file',
        path: featureId,
        message: 'Feature canonical_file must be a string.',
        suggestion: 'Use a repository-relative file path.',
      });
      continue;
    }
    const feature = rawFeature;
    if (!feature.canonicalFile) continue;
    const canonical = normalizeRepoPath(feature.canonicalFile);
    const canonicalProblem = unsafePathReason(feature.canonicalFile);
    if (canonicalProblem) {
      add({
        severity: 'error',
        code: 'unsafe-canonical-file',
        path: featureId,
        message: `Feature canonical_file "${feature.canonicalFile}" uses an unsafe ${canonicalProblem}.`,
        suggestion: 'Use a repository-relative file path.',
      });
    } else if (!exists(canonical)) {
      add({
        severity: 'warning',
        code: 'missing-canonical-file',
        path: featureId,
        message: `Feature canonical_file "${canonical}" does not exist.`,
        suggestion: 'Choose the current feature entry point or remove the stale pointer.',
      });
    }
  }

  for (const [id, locations] of collectDuplicateIds(canopy.files, 'todo')) {
    add({
      severity: 'error',
      code: 'duplicate-todo-id',
      message: `TODO ID ${id} is reused in ${locations.join(', ')}.`,
      suggestion: 'Assign a unique ID using the repository\'s established convention before editing either TODO.',
    });
  }

  for (const [id, locations] of collectDuplicateIds(canopy.files, 'comment')) {
    add({
      severity: 'error',
      code: 'duplicate-comment-id',
      message: `Comment ID ${id} is reused in ${locations.join(', ')}.`,
      suggestion: 'Assign a unique ID using the repository\'s established convention before reviewing either comment.',
    });
  }

  if ((evidence.pendingAgentReviews ?? 0) > 0) {
    add({
      severity: 'info',
      code: 'pending-agent-review',
      message: `${evidence.pendingAgentReviews} agent manifest entr${evidence.pendingAgentReviews === 1 ? 'y is' : 'ies are'} awaiting review.`,
      suggestion: 'Review canopytag/agent_manifest.json or use the Activity view.',
    });
  }
  if (evidence.manifestError) {
    add({
      severity: 'error',
      code: 'invalid-agent-manifest',
      message: `agent_manifest.json could not be read: ${evidence.manifestError}`,
      suggestion: 'Repair the sidecar before relying on agent activity or undo review.',
    });
  }

  // Agent writes that recorded no model identity. Reported as one aggregate
  // rather than per record: a repo that has been running a while accumulates
  // these in bulk, and hundreds of identical findings would crowd out every
  // other check without telling the reader anything more.
  const unattributedPaths: string[] = [];
  let unattributedRecords = 0;
  for (const [filePath, rawCard] of Object.entries(canopy.files)) {
    if (!isRecord(rawCard)) continue;
    const card = rawCard as FileCanopy;
    let fileHasGap = false;
    const noteGap = (author: unknown) => {
      if (!isUnattributedAgent(author as FileCanopy['lastReviewedBy'])) return;
      unattributedRecords += 1;
      fileHasGap = true;
    };

    // Malformed cards reach doctor by design — it must report them, not crash.
    noteGap(card.lastReviewedBy);
    if (Array.isArray(card.todos)) {
      for (const todo of card.todos) if (isRecord(todo)) noteGap(todo.createdBy);
    }
    if (Array.isArray(card.comments)) {
      for (const comment of card.comments) if (isRecord(comment)) noteGap(comment.author);
    }

    if (fileHasGap) unattributedPaths.push(filePath);
  }

  if (unattributedRecords > 0) {
    const sample = unattributedPaths.slice(0, 3).join(', ');
    const more = unattributedPaths.length > 3 ? `, +${unattributedPaths.length - 3} more` : '';
    add({
      severity: 'warning',
      code: 'unattributed-agent',
      message: `${unattributedRecords} agent-authored record(s) across ${unattributedPaths.length} file(s) record no model identity (${sample}${more}).`,
      suggestion: 'Pass agent_name on canopytag writes (e.g. "Claude Opus 5"), or set CANOPYTAG_AGENT_NAME for the MCP server.',
    });
  }

  allIssues.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) return byCode;
    return (a.path ?? '').localeCompare(b.path ?? '');
  });

  const counts: DoctorCounts = {
    errors: allIssues.filter(issue => issue.severity === 'error').length,
    warnings: allIssues.filter(issue => issue.severity === 'warning').length,
    info: allIssues.filter(issue => issue.severity === 'info').length,
  };
  const issueLimit = clampIssueLimit(evidence.issueLimit);

  const countsByCode: Record<string, number> = {};
  for (const issue of allIssues) {
    countsByCode[issue.code] = (countsByCode[issue.code] ?? 0) + 1;
  }

  return {
    ok: counts.errors === 0,
    strictOk: counts.errors === 0 && counts.warnings === 0,
    counts,
    countsByCode,
    totalIssues: allIssues.length,
    checked: {
      annotations: Object.keys(canopy.files).length,
      features: Object.keys(canopy.features).length,
      trackedFiles: evidence.repoFiles.size,
    },
    issues: selectRepresentativeIssues(allIssues, issueLimit),
    omittedIssues: Math.max(0, allIssues.length - issueLimit),
  };
}

/**
 * Truncate to `limit` while guaranteeing every finding code keeps at least one
 * example. A flat slice of a severity-then-code sort lets a high-volume code
 * bury a low-volume one entirely: 43 review-drift warnings pushed the single
 * repo-wide unattributed-agent finding past a limit of 50, so the reader learned
 * nothing about it. Volume of detail is worth bounding; existence is not.
 */
export function selectRepresentativeIssues(sorted: DoctorIssue[], limit: number): DoctorIssue[] {
  if (sorted.length <= limit) return sorted;

  const picked = new Set<number>();
  const seenCodes = new Set<string>();

  // First pass: the highest-ranked example of each code, in sort order.
  for (let i = 0; i < sorted.length && picked.size < limit; i += 1) {
    if (seenCodes.has(sorted[i].code)) continue;
    seenCodes.add(sorted[i].code);
    picked.add(i);
  }

  // Second pass: spend whatever budget is left following the existing order.
  for (let i = 0; i < sorted.length && picked.size < limit; i += 1) {
    picked.add(i);
  }

  return [...picked].sort((a, b) => a - b).map(index => sorted[index]);
}

function repoPathKind(repoRoot: string, relativePath: string): 'file' | 'directory' | undefined {
  if (unsafePathReason(relativePath)) return undefined;
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, ...normalizeRepoPath(relativePath).split('/'));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  try {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
  } catch {
    // Missing or unreadable paths have no kind.
  }
  return undefined;
}

export function buildDoctorFromRepo(
  repoRoot: string,
  canopyPath: string,
  issueLimit = DEFAULT_ISSUE_LIMIT,
): DoctorReport {
  const canopy = readCanopy(canopyPath);
  const repoFiles = discoverTrackedFiles(repoRoot);
  const freshnessPaths = collectDoctorFreshnessPaths(canopy.files);
  const gitDates = getLastModifiedBatch(repoRoot, freshnessPaths);
  let pendingAgentReviews = 0;
  let manifestError: string | undefined;
  try {
    const manifest = readAgentManifest(resolveAgentManifestPathFromCanopyPath(canopyPath));
    pendingAgentReviews = manifest.entries.filter(entry => entry.status === 'pending').length;
  } catch (error) {
    manifestError = error instanceof Error ? error.message : String(error);
  }

  return inspectCanopyDoctor(canopy, {
    repoFiles,
    gitDates,
    pendingAgentReviews,
    manifestError,
    issueLimit,
    pathKind: relativePath => repoPathKind(repoRoot, relativePath),
    pathExists: relativePath => repoPathKind(repoRoot, relativePath) !== undefined,
  });
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [
    `CanopyTag doctor: ${report.counts.errors} errors, ${report.counts.warnings} warnings, ${report.counts.info} info`,
    `Checked ${report.checked.annotations} annotations, ${report.checked.features} features, ${report.checked.trackedFiles} tracked files.`,
  ];

  if (report.issues.length === 0) {
    lines.push('', 'No deterministic maintenance findings. Semantic accuracy still requires review.');
    return lines.join('\n');
  }

  const icon: Record<DoctorSeverity, string> = { error: '!!', warning: '??', info: '--' };
  lines.push('');
  for (const issue of report.issues) {
    const location = issue.path ? ` ${issue.path}` : '';
    lines.push(`${icon[issue.severity]} [${issue.code}]${location}: ${issue.message}`);
    if (issue.suggestion) lines.push(`   Next: ${issue.suggestion}`);
  }
  if (report.omittedIssues > 0) {
    const byCode = Object.entries(report.countsByCode)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => `${code} ${count}`)
      .join(', ');
    lines.push(
      '',
      `${report.omittedIssues} of ${report.totalIssues} findings not shown. At least one of every type appears above.`,
      `All types: ${byCode}`,
      report.totalIssues <= MAX_ISSUE_LIMIT
        ? `Use --limit ${report.totalIssues} to see every finding, or a focused command.`
        : `Use --limit ${MAX_ISSUE_LIMIT} (the maximum) or a focused command.`,
    );
  }
  lines.push('', 'Doctor does not rewrite summaries, scores, authority, tags, or relationships.');
  return lines.join('\n');
}

function run(): void {
  const { values } = parseArgs({
    options: {
      ...CORE_OPTIONS,
      format: { type: 'string' },
      strict: { type: 'boolean' },
      limit: { type: 'string', short: 'n' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(`canopytag doctor — deterministic maintenance checks

Usage:
  canopytag doctor [--repo <path>] [--format text|json] [--strict] [--limit 50]

Checks objective, low-judgment hazards: malformed nested metadata, unsafe or
broken paths, orphaned cards, duplicate TODO/comment IDs, Git-backed review
drift, portable repo_root usage, feature entry points, and pending agent-review
entries.

Options:
  --repo, -r       Path to the target repo (default: current directory)
  --format         text (default) or json
  --strict         Exit nonzero for warnings as well as errors
  --limit, -n      Maximum rendered findings (default: 50, max: 500)
  --help, -h       Show this help

Doctor never invents or rewrites semantic annotations.
`);
    return;
  }

  const format = (values.format as string | undefined) ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error('--format must be text or json');
  }
  const parsedLimit = values.limit == null ? DEFAULT_ISSUE_LIMIT : Number(values.limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_ISSUE_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_ISSUE_LIMIT}`);
  }

  const repoRoot = resolveRepoRoot(values.repo as string | undefined);
  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const report = buildDoctorFromRepo(repoRoot, canopyPath, parsedLimit);
  process.stdout.write(format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${renderDoctorText(report)}\n`);
  process.exitCode = values.strict ? (report.strictOk ? 0 : 1) : (report.ok ? 0 : 1);
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').match(/cli\/doctor\.[tj]s$/);
if (isDirectRun) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`canopytag doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
