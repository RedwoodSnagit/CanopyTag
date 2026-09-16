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
import { findProjectTaskDependencyCycles } from '../shared/project-tasks.js';
import type {
  ActionReceiptKind,
  ActionReceiptOutcome,
  Canopy,
  FileCanopy,
  FileRelation,
  Project,
  RelatedFileEntry,
  ResourceKind,
  ResourceRole,
  ScopeMemberRole,
  ScopeSubjectKind,
  Task,
  TaskDependencyType,
} from '../shared/types.js';
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
    projects: number;
    scopes: number;
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
const SCOPE_SUBJECT_KINDS = new Set<ScopeSubjectKind>(['file', 'directory']);
const SCOPE_MEMBER_ROLES = new Set<ScopeMemberRole>([
  'component', 'entrypoint', 'canonical_document', 'test', 'resource',
]);
const TASK_STATUSES = new Set(['open', 'in_progress', 'done', 'deferred']);
const TASK_DEPENDENCY_TYPES = new Set<TaskDependencyType>(['blocks', 'depends_on', 'parent_child', 'related']);
const RESOURCE_KINDS = new Set<ResourceKind>([
  'file', 'component', 'documentation', 'tool', 'procedure', 'dataset', 'artifact', 'command', 'test', 'output',
]);
const RESOURCE_ROLES = new Set<ResourceRole>([
  'implements', 'governs', 'use_for', 'input', 'validates', 'must_produce', 'reference',
]);
const RECEIPT_KINDS = new Set<ActionReceiptKind>(['change', 'commit', 'validation', 'output', 'review', 'decision']);
const RECEIPT_OUTCOMES = new Set<ActionReceiptOutcome>(['recorded', 'passed', 'failed', 'accepted', 'rejected']);
const RICH_TASK_FIELDS = [
  'whyNow', 'acceptance', 'dependencies', 'milestoneId', 'owners', 'reviewers', 'openQuestions',
  'ownedPaths', 'excludedPaths', 'resources', 'receipts', 'residualRisks',
] as const;

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

function isRichProjectTask(value: object): boolean {
  const record = value as Record<string, unknown>;
  return RICH_TASK_FIELDS.some(field => record[field] !== undefined);
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
  projects: Record<string, Project> = {},
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
  if (kind === 'todo') {
    for (const [projectId, rawProject] of Object.entries(projects)) {
      if (!isRecord(rawProject)) continue;
      const items = Array.isArray(rawProject.todos) ? rawProject.todos : [];
      for (const item of items) {
        if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue;
        const locations = occurrences.get(item.id) ?? [];
        locations.push(`project:${projectId}`);
        occurrences.set(item.id, locations);
      }
    }
  }
  return new Map([...occurrences].filter(([, locations]) => locations.length > 1));
}

/** Pure inspection layer, separated from Git and filesystem discovery for tests and reuse. */
export function inspectCanopyDoctor(canopy: Canopy, evidence: DoctorEvidence): DoctorReport {
  const allIssues: DoctorIssue[] = [];
  const exists = evidence.pathExists ?? ((relativePath: string) => evidence.repoFiles.has(relativePath));
  const add = (issue: DoctorIssue) => allIssues.push(issue);
  const validateResourceRefs = (value: unknown, issuePath: string, context: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      add({ severity: 'error', code: 'invalid-task-resources', path: issuePath, message: `${context} resources must be an array.` });
      return;
    }
    for (const resource of value) {
      if (!isRecord(resource)
        || !RESOURCE_KINDS.has(resource.kind as ResourceKind)
        || !RESOURCE_ROLES.has(resource.role as ResourceRole)
        || typeof resource.ref !== 'string'
        || resource.ref.trim().length === 0) {
        add({
          severity: 'error',
          code: 'invalid-task-resource',
          path: issuePath,
          message: `${context} contains a resource without a valid kind, role, and non-empty ref.`,
        });
        continue;
      }
      if (!['file', 'component', 'documentation'].includes(resource.kind as string)) continue;
      const problem = unsafePathReason(resource.ref);
      if (problem) {
        add({
          severity: 'error',
          code: 'unsafe-task-resource-path',
          path: issuePath,
          message: `${context} resource "${resource.ref}" uses an unsafe ${problem}.`,
        });
      } else if (resource.role !== 'must_produce' && !exists(normalizeRepoPath(resource.ref))) {
        add({
          severity: 'warning',
          code: 'missing-task-resource',
          path: issuePath,
          message: `${context} resource "${resource.ref}" does not exist.`,
          suggestion: 'Correct the reference or retain a logical non-path resource kind.',
        });
      }
    }
  };

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

  for (const [scopeId, rawScope] of Object.entries(canopy.scopeSets ?? {})) {
    if (!isRecord(rawScope)) {
      add({
        severity: 'error',
        code: 'invalid-scope-set',
        path: scopeId,
        message: 'Scope-set metadata must be an object.',
        suggestion: 'Restore the authored scope card or remove it intentionally.',
      });
      continue;
    }
    if (scopeId.trim().length === 0) {
      add({
        severity: 'error', code: 'invalid-scope-id',
        message: 'Scope set ID must be a non-empty authored identifier.',
      });
    }
    if (typeof rawScope.name !== 'string' || rawScope.name.trim().length === 0) {
      add({
        severity: 'error', code: 'invalid-scope-name', path: scopeId,
        message: 'Scope set name must be a non-empty string.',
      });
    }
    if (rawScope.description !== undefined && typeof rawScope.description !== 'string') {
      add({
        severity: 'error', code: 'invalid-scope-description', path: scopeId,
        message: 'Scope set description must be a string.',
      });
    }
    if (!Array.isArray(rawScope.members)) {
      add({
        severity: 'error', code: 'invalid-scope-members', path: scopeId,
        message: 'Scope set members must be an array.',
        suggestion: 'List explicit file or directory subjects; generated candidates belong in the generated sidecar.',
      });
      continue;
    }
    if (rawScope.members.length === 0) {
      add({
        severity: 'info', code: 'empty-scope-set', path: scopeId,
        message: 'Scope set has no authored members.',
        suggestion: 'Add reviewed subjects or remove the placeholder scope.',
      });
    }

    const seen = new Set<string>();
    for (const [index, rawMember] of rawScope.members.entries()) {
      if (!isRecord(rawMember)) {
        add({
          severity: 'error', code: 'invalid-scope-member', path: scopeId,
          message: `Scope member ${index} must be an object.`,
        });
        continue;
      }
      if (typeof rawMember.path !== 'string' || rawMember.path.length === 0) {
        add({
          severity: 'error', code: 'invalid-scope-member-path', path: scopeId,
          message: `Scope member ${index} must have a non-empty path.`,
        });
        continue;
      }
      if (typeof rawMember.kind !== 'string' ||
          !SCOPE_SUBJECT_KINDS.has(rawMember.kind as ScopeSubjectKind)) {
        add({
          severity: 'error', code: 'invalid-scope-member-kind', path: scopeId,
          message: `Scope member "${rawMember.path}" kind must be file or directory.`,
        });
        continue;
      }
      if (rawMember.role !== undefined &&
          (typeof rawMember.role !== 'string' ||
           !SCOPE_MEMBER_ROLES.has(rawMember.role as ScopeMemberRole))) {
        add({
          severity: 'error', code: 'invalid-scope-member-role', path: scopeId,
          message: `Scope member "${rawMember.path}" has an unsupported role.`,
        });
      }

      const normalized = normalizeRepoPath(rawMember.path);
      const memberProblem = unsafePathReason(rawMember.path);
      if (memberProblem) {
        add({
          severity: 'error', code: 'unsafe-scope-member', path: scopeId,
          message: `Scope member "${rawMember.path}" uses an unsafe ${memberProblem}.`,
          suggestion: 'Use a repository-relative file or directory path.',
        });
        continue;
      }
      const identity = normalized;
      if (seen.has(identity)) {
        add({
          severity: 'warning', code: 'duplicate-scope-member', path: scopeId,
          message: `Scope member "${normalized}" is listed more than once.`,
          suggestion: 'Keep one authored membership so the coverage denominator is reviewable.',
        });
        continue;
      }
      seen.add(identity);

      const actualKind = evidence.pathKind?.(normalized)
        ?? (evidence.repoFiles.has(normalized) ? 'file' : undefined);
      if (actualKind === undefined) {
        add({
          severity: 'warning', code: 'missing-scope-member', path: scopeId,
          message: `Scope ${rawMember.kind} "${normalized}" does not exist.`,
          suggestion: 'Correct or remove the stale authored member; generated proposals do not repair authored scope automatically.',
        });
      } else if (actualKind !== rawMember.kind) {
        add({
          severity: 'warning', code: 'scope-member-kind-mismatch', path: scopeId,
          message: `Scope member "${normalized}" is declared ${rawMember.kind} but is a ${actualKind}.`,
          suggestion: 'Correct the explicit kind so directory subjects are not treated as missing files.',
        });
      }
    }
  }

  for (const [projectKey, rawProject] of Object.entries(canopy.projects ?? {})) {
    if (!isRecord(rawProject)) {
      add({
        severity: 'error',
        code: 'invalid-project-card',
        path: projectKey,
        message: 'Project metadata must be an object.',
        suggestion: 'Restore the project card object or remove the malformed entry intentionally.',
      });
      continue;
    }

    if (typeof rawProject.id !== 'string' || rawProject.id.length === 0) {
      add({ severity: 'error', code: 'invalid-project-id', path: projectKey, message: 'Project id must be a non-empty string.' });
    } else if (rawProject.id !== projectKey) {
      add({
        severity: 'error',
        code: 'project-key-mismatch',
        path: projectKey,
        message: `Project key does not match its id "${rawProject.id}".`,
        suggestion: 'Use the project ID as both the map key and card id.',
      });
    }
    if (typeof rawProject.name !== 'string' || rawProject.name.trim().length === 0) {
      add({ severity: 'error', code: 'invalid-project-name', path: projectKey, message: 'Project name must be a non-empty string.' });
    }
    if (!['active', 'paused', 'done'].includes(String(rawProject.status))) {
      add({ severity: 'error', code: 'invalid-project-status', path: projectKey, message: 'Project status must be active, paused, or done.' });
    }
    if (typeof rawProject.createdAt !== 'string' || rawProject.createdAt.length === 0) {
      add({ severity: 'error', code: 'invalid-project-created-at', path: projectKey, message: 'Project created_at must be a non-empty ISO date string.' });
    }
    if (rawProject.createdBy === undefined ||
        (typeof rawProject.createdBy !== 'string' && !isRecord(rawProject.createdBy))) {
      add({ severity: 'error', code: 'invalid-project-created-by', path: projectKey, message: 'Project created_by must be an author signature.' });
    }
    if (rawProject.status === 'done' && typeof rawProject.completedAt !== 'string') {
      add({
        severity: 'warning', code: 'missing-project-completed-at', path: projectKey,
        message: 'Completed project has no completed_at timestamp.',
      });
    } else if (rawProject.status !== 'done' && rawProject.completedAt !== undefined) {
      add({
        severity: 'warning', code: 'unexpected-project-completed-at', path: projectKey,
        message: 'Active or paused project still has a completed_at timestamp.',
      });
    }

    for (const field of ['owners', 'featureIds', 'files', 'todos', 'milestones', 'openQuestions'] as const) {
      if (rawProject[field] !== undefined && !Array.isArray(rawProject[field])) {
        add({
          severity: 'error',
          code: `invalid-project-${field.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
          path: projectKey,
          message: `Project ${field} must be an array.`,
        });
      }
    }

    const milestoneIds = new Set<string>();
    if (Array.isArray(rawProject.milestones)) {
      for (const milestone of rawProject.milestones) {
        if (!isRecord(milestone)
          || typeof milestone.id !== 'string'
          || milestone.id.trim().length === 0
          || typeof milestone.name !== 'string'
          || milestone.name.trim().length === 0) {
          add({
            severity: 'error', code: 'invalid-project-milestone', path: projectKey,
            message: 'Each project milestone must have a non-empty id and name.',
          });
          continue;
        }
        if (milestoneIds.has(milestone.id)) {
          add({
            severity: 'error', code: 'duplicate-project-milestone-id', path: projectKey,
            message: `Milestone ID ${milestone.id} is repeated in project ${projectKey}.`,
          });
        }
        milestoneIds.add(milestone.id);
        for (const field of ['targetAt', 'completedAt'] as const) {
          if (milestone[field] !== undefined && typeof milestone[field] !== 'string') {
            add({
              severity: 'error', code: 'invalid-project-milestone-date', path: projectKey,
              message: `Milestone ${milestone.id} ${field} must be an ISO date string.`,
            });
          }
        }
      }
    }

    const taskRecords = Array.isArray(rawProject.todos)
      ? rawProject.todos.filter(isRecord)
      : [];
    if (Array.isArray(rawProject.todos)) {
      for (const task of rawProject.todos) {
        if (!isRecord(task)) {
          add({ severity: 'error', code: 'invalid-project-task', path: projectKey, message: 'Each project task must be an object.' });
        }
      }
    }
    const taskIds = new Set<string>();
    for (const task of taskRecords) {
      const taskLabel = typeof task.id === 'string' && task.id ? task.id : '(missing id)';
      if (typeof task.id !== 'string' || task.id.trim().length === 0
        || typeof task.text !== 'string' || task.text.trim().length === 0
        || typeof task.priority !== 'number' || ![1, 2, 3, 4, 5].includes(task.priority)
        || !TASK_STATUSES.has(String(task.status))
        || typeof task.createdAt !== 'string'
        || (typeof task.createdBy !== 'string' && !isRecord(task.createdBy))) {
        add({
          severity: 'error', code: 'invalid-project-task', path: projectKey,
          message: `Project task ${taskLabel} is missing a valid id, text, priority, status, created_at, or created_by.`,
        });
      }
      if (typeof task.id === 'string') {
        if (taskIds.has(task.id)) {
          add({
            severity: 'error', code: 'duplicate-project-task-id', path: projectKey,
            message: `Task ID ${task.id} is repeated in project ${projectKey}.`,
          });
        }
        taskIds.add(task.id);
      }
      if (task.status === 'done' && typeof task.completedAt !== 'string') {
        add({
          severity: 'warning', code: 'missing-task-completed-at', path: projectKey,
          message: `Completed task ${taskLabel} has no completed_at timestamp.`,
        });
      } else if (task.status !== 'done' && task.completedAt !== undefined) {
        add({
          severity: 'warning', code: 'unexpected-task-completed-at', path: projectKey,
          message: `Non-completed task ${taskLabel} still has a completed_at timestamp.`,
        });
      }

      for (const field of ['acceptance', 'dependencies', 'owners', 'reviewers', 'openQuestions', 'ownedPaths', 'excludedPaths', 'resources', 'receipts', 'residualRisks'] as const) {
        if (task[field] !== undefined && !Array.isArray(task[field])) {
          add({
            severity: 'error', code: 'invalid-project-task-field', path: projectKey,
            message: `Task ${taskLabel} ${field} must be an array.`,
          });
        }
      }
      for (const field of ['acceptance', 'openQuestions', 'residualRisks'] as const) {
        if (Array.isArray(task[field]) && task[field].some(value => typeof value !== 'string' || value.trim().length === 0)) {
          add({
            severity: 'error', code: 'invalid-project-task-text-list', path: projectKey,
            message: `Task ${taskLabel} ${field} must contain non-empty strings.`,
          });
        }
      }
      for (const field of ['ownedPaths', 'excludedPaths'] as const) {
        if (!Array.isArray(task[field])) continue;
        for (const candidate of task[field]) {
          if (typeof candidate !== 'string' || unsafePathReason(candidate)) {
            add({
              severity: 'error', code: 'unsafe-task-path', path: projectKey,
              message: `Task ${taskLabel} ${field} contains an unsafe or non-string path.`,
            });
          } else if (field === 'ownedPaths' && !exists(normalizeRepoPath(candidate.replace(/[\\/]$/, '')))) {
            add({
              severity: 'warning', code: 'missing-task-owned-path', path: projectKey,
              message: `Task ${taskLabel} owned path "${candidate}" does not exist.`,
            });
          }
        }
      }
      if (task.milestoneId !== undefined
        && (typeof task.milestoneId !== 'string' || !milestoneIds.has(task.milestoneId))) {
        add({
          severity: 'error', code: 'missing-task-milestone', path: projectKey,
          message: `Task ${taskLabel} references undefined milestone "${String(task.milestoneId)}".`,
        });
      }
      validateResourceRefs(task.resources, projectKey, `Task ${taskLabel}`);

      if (Array.isArray(task.dependencies)) {
        const seenEdges = new Set<string>();
        for (const dependency of task.dependencies) {
          if (!isRecord(dependency)
            || !TASK_DEPENDENCY_TYPES.has(dependency.type as TaskDependencyType)
            || typeof dependency.taskId !== 'string'
            || dependency.taskId.trim().length === 0) {
            add({
              severity: 'error', code: 'invalid-task-dependency', path: projectKey,
              message: `Task ${taskLabel} contains a dependency without a valid type and task_id.`,
            });
            continue;
          }
          const edgeKey = `${dependency.type}\u0000${dependency.taskId}`;
          if (seenEdges.has(edgeKey)) {
            add({
              severity: 'error', code: 'duplicate-task-dependency', path: projectKey,
              message: `Task ${taskLabel} repeats ${dependency.type} ${dependency.taskId}.`,
            });
          }
          seenEdges.add(edgeKey);
          if (dependency.taskId === task.id) {
            add({
              severity: 'error', code: 'self-task-dependency', path: projectKey,
              message: `Task ${taskLabel} references itself.`,
            });
          } else if (!taskRecords.some(candidate => candidate.id === dependency.taskId)) {
            add({
              severity: 'error', code: 'missing-task-dependency', path: projectKey,
              message: `Task ${taskLabel} references undefined task ${dependency.taskId}.`,
            });
          }
        }
      }

      if (Array.isArray(task.receipts)) {
        const receiptIds = new Set<string>();
        for (const receipt of task.receipts) {
          if (!isRecord(receipt)
            || typeof receipt.id !== 'string'
            || receipt.id.trim().length === 0
            || !RECEIPT_KINDS.has(receipt.kind as ActionReceiptKind)
            || !RECEIPT_OUTCOMES.has(receipt.outcome as ActionReceiptOutcome)
            || typeof receipt.summary !== 'string'
            || receipt.summary.trim().length === 0
            || typeof receipt.recordedAt !== 'string'
            || (typeof receipt.actor !== 'string' && !isRecord(receipt.actor))) {
            add({
              severity: 'error', code: 'invalid-action-receipt', path: projectKey,
              message: `Task ${taskLabel} contains a receipt without valid identity, outcome, summary, actor, or recorded_at.`,
            });
            continue;
          }
          if (receiptIds.has(receipt.id)) {
            add({
              severity: 'error', code: 'duplicate-action-receipt-id', path: projectKey,
              message: `Task ${taskLabel} repeats receipt ID ${receipt.id}.`,
            });
          }
          receiptIds.add(receipt.id);
          validateResourceRefs(receipt.resources, projectKey, `Receipt ${receipt.id}`);
        }
      }
      if (task.status === 'done' && isRichProjectTask(task)
        && (!Array.isArray(task.receipts) || task.receipts.length === 0)) {
        add({
          severity: 'warning', code: 'missing-task-completion-receipt', path: projectKey,
          message: `Rich completed task ${taskLabel} retains no completion receipt.`,
          suggestion: 'Record the action, validation, output, or review evidence that closed the task.',
        });
      }
    }

    const cycleTasks = taskRecords.map(task => ({
      ...task,
      dependencies: Array.isArray(task.dependencies)
        ? task.dependencies.filter(dependency => (
          isRecord(dependency)
          && TASK_DEPENDENCY_TYPES.has(dependency.type as TaskDependencyType)
          && typeof dependency.taskId === 'string'
        ))
        : undefined,
    })) as unknown as Task[];
    for (const cycle of findProjectTaskDependencyCycles(cycleTasks)) {
      add({
        severity: 'error', code: 'task-dependency-cycle', path: projectKey,
        message: `Blocking task dependency cycle: ${[...cycle, cycle[0]].join(' -> ')}.`,
        suggestion: 'Remove or retype one blocking edge; parent_child and related edges do not affect readiness.',
      });
    }

    if (Array.isArray(rawProject.files)) {
      for (const candidate of rawProject.files) {
        if (typeof candidate !== 'string') {
          add({ severity: 'error', code: 'invalid-project-file', path: projectKey, message: 'Each project file must be a string path.' });
          continue;
        }
        const fileProblem = unsafePathReason(candidate);
        if (fileProblem) {
          add({ severity: 'error', code: 'unsafe-project-file', path: projectKey, message: `Project file "${candidate}" uses an unsafe ${fileProblem}.` });
        } else if (!exists(normalizeRepoPath(candidate))) {
          add({
            severity: 'warning',
            code: 'missing-project-file',
            path: projectKey,
            message: `Project file "${candidate}" does not exist.`,
            suggestion: 'Update the project file list without inventing a replacement path.',
          });
        }
      }
    }
    if (Array.isArray(rawProject.featureIds)) {
      for (const featureId of rawProject.featureIds) {
        if (typeof featureId !== 'string') {
          add({ severity: 'error', code: 'invalid-project-feature', path: projectKey, message: 'Each project feature ID must be a string.' });
        } else if (!canopy.features[featureId]) {
          add({
            severity: 'warning',
            code: 'missing-project-feature',
            path: projectKey,
            message: `Project feature "${featureId}" is not defined.`,
            suggestion: 'Correct the feature ID or add the feature card intentionally.',
          });
        }
      }
    }
    if ((!Array.isArray(rawProject.files) || rawProject.files.length === 0) &&
        (!Array.isArray(rawProject.todos) || rawProject.todos.length === 0)) {
      add({
        severity: 'info',
        code: 'empty-project',
        path: projectKey,
        message: 'Project has neither implicated files nor project-owned TODOs.',
        suggestion: 'Add a concrete file or TODO, or remove the placeholder project.',
      });
    }
  }

  const projectIdLocations = new Map<string, string[]>();
  for (const [projectKey, rawProject] of Object.entries(canopy.projects ?? {})) {
    if (!isRecord(rawProject) || typeof rawProject.id !== 'string') continue;
    const locations = projectIdLocations.get(rawProject.id) ?? [];
    locations.push(projectKey);
    projectIdLocations.set(rawProject.id, locations);
  }
  for (const [id, locations] of projectIdLocations) {
    if (locations.length < 2) continue;
    add({
      severity: 'error', code: 'duplicate-project-id',
      message: `Project ID ${id} is reused by keys ${locations.join(', ')}.`,
      suggestion: 'Assign unique PRJ identifiers and update references intentionally.',
    });
  }

  for (const [id, locations] of collectDuplicateIds(canopy.files, 'todo', canopy.projects ?? {})) {
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
  for (const [projectId, rawProject] of Object.entries(canopy.projects ?? {})) {
    if (!isRecord(rawProject)) continue;
    let projectHasGap = false;
    const noteGap = (author: unknown) => {
      if (!isUnattributedAgent(author as Project['createdBy'])) return;
      unattributedRecords += 1;
      projectHasGap = true;
    };
    noteGap(rawProject.createdBy);
    if (Array.isArray(rawProject.owners)) for (const owner of rawProject.owners) noteGap(owner);
    if (Array.isArray(rawProject.todos)) {
      for (const todo of rawProject.todos) {
        if (!isRecord(todo)) continue;
        noteGap(todo.createdBy);
        if (Array.isArray(todo.owners)) for (const owner of todo.owners) noteGap(owner);
        if (Array.isArray(todo.reviewers)) for (const reviewer of todo.reviewers) noteGap(reviewer);
        if (Array.isArray(todo.receipts)) {
          for (const receipt of todo.receipts) if (isRecord(receipt)) noteGap(receipt.actor);
        }
      }
    }
    if (projectHasGap) unattributedPaths.push(`project:${projectId}`);
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
      projects: Object.keys(canopy.projects ?? {}).length,
      scopes: Object.keys(canopy.scopeSets ?? {}).length,
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
    `Checked ${report.checked.annotations} annotations, ${report.checked.features} features, ${report.checked.projects} projects, ${report.checked.scopes} scope sets, ${report.checked.trackedFiles} tracked files.`,
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
