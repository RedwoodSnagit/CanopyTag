#!/usr/bin/env node
/**
 * canopytag todos — flat view of all TODOs across the repo
 *
 * Usage:
 *   canopytag todos                           # all open TODOs, sorted by priority
 *   canopytag todos --tag release-blocker     # scoped to tag
 *   canopytag todos --feature core            # scoped to feature
 *   canopytag todos --priority 2              # P1 and P2 only
 *   canopytag todos --all                     # include done/deferred
 *   canopytag todos --repo /path/to/repo      # specify repo root
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import type { Canopy, FileCanopy, Priority } from '../shared/types.js';
import {
  resolveCanopyPath, resolveRepoRoot, truncate,
  CORE_OPTIONS, FILTER_OPTIONS, LIST_OPTIONS,
  parseBaseFilters, filterFiles, needsGitDates, fetchGitDates,
  type FileFilters,
} from './shared.js';
import { findProject } from './projects.js';

export interface TodoRow {
  id: string;
  priority: Priority;
  difficulty: string;    // "D2" or "-"
  text: string;
  status: string;
  tags: string;          // comma-joined
  file: string;          // backward-compatible subject label
  scope: string;         // file path or project ID
  scopeKind: 'file' | 'project';
  feature: string;       // feature ID or "-"
  createdBy: string;     // "human" or "agent:claude"
}

export interface TodoFilters {
  tag?: string;           // kept here — todos has unique OR logic (todo-tag OR file-tag)
  maxPriority?: number;
  all?: boolean;
  project?: string;
  feature?: string;
  includeProjects?: boolean;
}

export function collectTodos(canopy: Canopy, filters: TodoFilters = {}, fileEntries?: [string, FileCanopy][]): TodoRow[] {
  const rows: TodoRow[] = [];
  const entries = fileEntries ?? Object.entries(canopy.files);

  for (const [filePath, fc] of entries) {
    if (!fc.todos?.length) continue;

    // No feature filter here — handled by filterFiles upstream

    for (const todo of fc.todos) {
      if (!filters.all && (todo.status === 'done' || todo.status === 'deferred')) continue;
      if (filters.maxPriority && todo.priority > filters.maxPriority) continue;

      // Tag filter: match TODO tags OR file tags (unique OR logic for todos command)
      if (filters.tag) {
        const tagLower = filters.tag.toLowerCase();
        const todoTags = (todo.tags ?? []).map(t => t.toLowerCase());
        const fileTags = (fc.tags ?? []).map(t => t.toLowerCase());
        if (!todoTags.includes(tagLower) && !fileTags.includes(tagLower)) continue;
      }

      // Format createdBy
      let createdBy = 'human';
      if (typeof todo.createdBy === 'string') {
        createdBy = todo.createdBy;
      } else if (todo.createdBy?.name) {
        createdBy = `${todo.createdBy.role}:${todo.createdBy.name}`;
      } else {
        createdBy = todo.createdBy?.role ?? 'unknown';
      }

      rows.push({
        id: todo.id,
        priority: todo.priority,
        difficulty: todo.difficulty ? `D${todo.difficulty}` : '-',
        text: todo.text,
        status: todo.status,
        tags: (todo.tags ?? []).join(', ') || '-',
        file: filePath,
        scope: filePath,
        scopeKind: 'file',
        feature: fc.featureId ?? '-',
        createdBy,
      });
    }
  }

  if (filters.includeProjects !== false) {
    for (const [projectKey, project] of Object.entries(canopy.projects ?? {})) {
      if (filters.project && projectKey !== filters.project && project.id !== filters.project) continue;
      if (filters.feature && !(project.featureIds ?? []).includes(filters.feature)) continue;
      for (const todo of project.todos ?? []) {
        if (!filters.all && (todo.status === 'done' || todo.status === 'deferred')) continue;
        if (filters.maxPriority && todo.priority > filters.maxPriority) continue;
        if (filters.tag && !(todo.tags ?? []).some(tag => tag.toLowerCase() === filters.tag!.toLowerCase())) continue;

        let createdBy = 'human';
        if (typeof todo.createdBy === 'string') createdBy = todo.createdBy;
        else if (todo.createdBy?.name) createdBy = `${todo.createdBy.role}:${todo.createdBy.name}`;
        else createdBy = todo.createdBy?.role ?? 'unknown';

        rows.push({
          id: todo.id,
          priority: todo.priority,
          difficulty: todo.difficulty ? `D${todo.difficulty}` : '-',
          text: todo.text,
          status: todo.status,
          tags: (todo.tags ?? []).join(', ') || '-',
          file: project.id,
          scope: project.id,
          scopeKind: 'project',
          feature: project.featureIds?.length
            ? `${project.featureIds.slice(0, 2).join(', ')}${project.featureIds.length > 2 ? ` +${project.featureIds.length - 2}` : ''}`
            : '-',
          createdBy,
        });
      }
    }
  }

  // Sort: priority ascending (P1 first), then by ID for stability
  rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  return rows;
}

export function buildTodos(
  canopy: Canopy,
  filters: FileFilters,
  opts: { priority?: number; limit?: number; all?: boolean; repoRoot?: string; project?: string } = {},
): string {
  const lines: string[] = [];
  const projectId = opts.project ? findProject(canopy, opts.project)[1].id : undefined;

  // Tag has special OR logic in todos: match todo-tag OR file-tag
  const tag = filters.tag;
  const fileFilters = { ...filters };
  delete fileFilters.tag;

  const allEntries = Object.entries(canopy.files);
  const gitDates = needsGitDates(fileFilters)
    ? fetchGitDates(opts.repoRoot ?? process.cwd(), allEntries.map(([p]) => p))
    : undefined;
  const fileEntries = filterFiles(allEntries, fileFilters, gitDates);

  const rows = collectTodos(canopy, {
    tag,
    maxPriority: opts.priority,
    all: opts.all,
    feature: filters.feature,
    includeProjects: !(
      filters.kind || filters.unreviewed || filters.surprising || filters.taggedAfter ||
      filters.taggedBefore || filters.gitAfter || filters.gitBefore
    ),
    project: projectId,
  }, fileEntries);

  const scopedRows = projectId ? rows.filter(row => row.scopeKind === 'project') : rows;

  if (scopedRows.length === 0) {
    return 'No TODOs match.';
  }

  const limit = opts.limit ?? 20;
  const shown = scopedRows.slice(0, limit);
  const remaining = scopedRows.length - shown.length;

  // Render table
  const fileCol = Math.max(5, ...shown.map(r => r.scope.length));
  const maxFileCol = 40;
  const fileWidth = Math.min(fileCol, maxFileCol);
  const featureWidth = Math.min(24, Math.max(10, ...shown.map(row => row.feature.length)));

  lines.push(
    `${'ID'.padEnd(7)}  ${'P'.padEnd(2)}  ${'D'.padEnd(2)}  ${'STATUS'.padEnd(11)}  ${'SCOPE'.padEnd(fileWidth)}  ${'KIND'.padEnd(7)}  ${'FEATURE'.padEnd(featureWidth)}  TEXT`
  );
  lines.push('-'.repeat(7 + 2 + 2 + 2 + 2 + 2 + 11 + 2 + fileWidth + 2 + 7 + 2 + featureWidth + 2 + 4));

  for (const r of shown) {
    const fileTrunc = truncate(r.scope, fileWidth);
    lines.push(
      `${r.id.padEnd(7)}  P${r.priority}  ${r.difficulty.padEnd(2)}  ${r.status.padEnd(11)}  ${fileTrunc.padEnd(fileWidth)}  ${r.scopeKind.padEnd(7)}  ${truncate(r.feature, featureWidth).padEnd(featureWidth)}  ${truncate(r.text, 60)}`
    );
  }

  if (remaining > 0) {
    lines.push(`\n... ${remaining} more. Use --limit ${scopedRows.length} to see all.`);
  }

  // Summary
  const p1Count = scopedRows.filter(r => r.priority === 1).length;
  const p2Count = scopedRows.filter(r => r.priority === 2).length;
  const parts: string[] = [`${scopedRows.length} Canopy TODOs`];
  if (p1Count > 0) parts.push(`${p1Count} P1`);
  if (p2Count > 0) parts.push(`${p2Count} P2`);
  lines.push(`\n${parts.join(', ')}`);

  return lines.join('\n');
}

function run() {
  const { values } = parseArgs({
    options: {
      ...CORE_OPTIONS, ...FILTER_OPTIONS, ...LIST_OPTIONS,
      priority: { type: 'string', short: 'p' },
      project: { type: 'string' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag todos — flat view of Canopy-native file and project TODOs

Options:
  -r, --repo <path>       Repo root (default: cwd)
  -f, --feature <name>    Filter by feature ID
      --project <id>      Only TODOs owned by one project
  -t, --tag <name>        Filter by TODO or file tag
  -k, --kind <type>       Filter by file kind: doc, code, test, config, asset, data
      --unreviewed        Only files with unreviewed scores
      --surprising        Only files tagged 'surprising' or with finding comments
      --tagged-after <date>     Annotation reviewed on or after ISO date
      --tagged-before <date>    Annotation reviewed on or before ISO date
      --git-after <date>        Source file git-modified on or after ISO date
      --git-before <date>       Source file git-modified on or before ISO date
  -p, --priority <1-5>    Show up to this priority (e.g. 2 = P1+P2)
  -n, --limit <count>     Max results (default: 20)
  -a, --all               Include done/deferred TODOs
  -h, --help              Show this help`);
    return;
  }

  const repoRoot = resolveRepoRoot(values.repo as string | undefined);
  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const canopy = readCanopy(canopyPath);

  const maxPriority = parseInt(values.priority as string, 10) || undefined;
  if (maxPriority !== undefined && (maxPriority < 1 || maxPriority > 5)) {
    console.error('Invalid priority: must be 1-5');
    process.exit(1);
  }

  let filters: FileFilters;
  try {
    filters = parseBaseFilters(values);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }

  try {
    console.log(buildTodos(canopy, filters, {
      priority: maxPriority,
      limit: parseInt(values.limit as string, 10) || undefined,
      all: values.all as boolean | undefined,
      repoRoot,
      project: values.project as string | undefined,
    }));
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

// Guard: don't run when imported as a module (e.g. in tests)
const isDirectRun = process.argv[1]?.endsWith('todos.ts') || process.argv[1]?.endsWith('todos.js');
if (isDirectRun) run();
