#!/usr/bin/env node
/**
 * canopytag projects — thin multi-file work/context umbrellas
 *
 * Projects connect intent, features, files, questions, and project-owned
 * TODOs. They are deliberately not boards, sprints, or nested task trees.
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import type { AgentManifest, Author, Canopy, Project } from '../shared/types.js';
import { normalizeAuthor } from '../shared/types.js';
import { CORE_OPTIONS, resolveCanopyPath, truncate } from './shared.js';

export interface ProjectRow {
  id: string;
  name: string;
  status: Project['status'];
  owners: string;
  features: string;
  files: number;
  openTodos: number;
}

function formatAuthor(author: Author): string {
  const signature = normalizeAuthor(author);
  return signature.name ? `${signature.role}:${signature.name}` : signature.role;
}

function compactList(values: string[] | undefined, limit = 3): string {
  if (!values?.length) return '-';
  const shown = values.slice(0, limit).join(', ');
  return values.length > limit ? `${shown} +${values.length - limit}` : shown;
}

export function findProject(canopy: Canopy, ref: string): [string, Project] {
  const projects = Object.entries(canopy.projects ?? {});
  const exact = projects.find(([key, project]) =>
    key === ref || project.id === ref || project.name.toLowerCase() === ref.toLowerCase()
  );
  if (exact) return exact;

  const needle = ref.toLowerCase();
  const matches = projects.filter(([key, project]) =>
    key.toLowerCase().includes(needle) ||
    project.id.toLowerCase().includes(needle) ||
    project.name.toLowerCase().includes(needle)
  );
  if (matches.length === 0) throw new Error(`Project not found: ${ref}`);
  if (matches.length > 1) {
    throw new Error(`Project reference is ambiguous: ${ref} (${matches.map(([, p]) => p.id).join(', ')})`);
  }
  return matches[0];
}

export function collectProjects(
  canopy: Canopy,
  opts: { status?: Project['status']; all?: boolean } = {},
): ProjectRow[] {
  return Object.values(canopy.projects ?? {})
    .filter(project => opts.all || opts.status !== undefined || project.status !== 'done')
    .filter(project => !opts.status || project.status === opts.status)
    .map(project => ({
      id: project.id,
      name: project.name,
      status: project.status,
      owners: (project.owners ?? []).map(formatAuthor).join(', ') || '-',
      features: compactList(project.featureIds),
      files: project.files?.length ?? 0,
      openTodos: (project.todos ?? []).filter(todo => todo.status === 'open' || todo.status === 'in_progress').length,
    }))
    .sort((a, b) => {
      const rank = { active: 0, paused: 1, done: 2 };
      return rank[a.status] - rank[b.status] || a.id.localeCompare(b.id);
    });
}

export function buildProjects(
  canopy: Canopy,
  opts: { status?: Project['status']; all?: boolean; limit?: number } = {},
): string {
  const rows = collectProjects(canopy, opts);
  if (rows.length === 0) return 'No projects match.';

  const limit = opts.limit ?? 20;
  const shown = rows.slice(0, limit);
  const nameWidth = Math.min(36, Math.max(4, ...shown.map(row => row.name.length)));
  const lines = [
    `${'ID'.padEnd(9)}  ${'STATUS'.padEnd(7)}  ${'NAME'.padEnd(nameWidth)}  ${'FILES'.padStart(5)}  ${'TODO'.padStart(4)}  FEATURES`,
    '-'.repeat(9 + 2 + 7 + 2 + nameWidth + 2 + 5 + 2 + 4 + 2 + 8),
  ];
  for (const row of shown) {
    lines.push(
      `${row.id.padEnd(9)}  ${row.status.padEnd(7)}  ${truncate(row.name, nameWidth).padEnd(nameWidth)}  ${String(row.files).padStart(5)}  ${String(row.openTodos).padStart(4)}  ${row.features}`
    );
  }
  if (rows.length > shown.length) lines.push(`\n... ${rows.length - shown.length} more. Use --limit ${rows.length} to see all.`);
  lines.push(`\n${rows.length} project${rows.length === 1 ? '' : 's'}`);
  return lines.join('\n');
}

export function buildProjectDetail(
  canopy: Canopy,
  ref: string,
  manifest?: AgentManifest,
): string {
  const [key, project] = findProject(canopy, ref);
  const lines = [
    `${project.id} — ${project.name}`,
    `Status: ${project.status}`,
  ];
  if (project.description) lines.push(`Why: ${project.description}`);
  if (project.owners?.length) lines.push(`Owners: ${project.owners.map(formatAuthor).join(', ')}`);
  if (project.featureIds?.length) lines.push(`Features: ${project.featureIds.join(', ')}`);
  if (project.createdAt) lines.push(`Created: ${project.createdAt} by ${formatAuthor(project.createdBy)}`);
  if (project.completedAt) lines.push(`Completed: ${project.completedAt}`);

  lines.push('', `Files (${project.files?.length ?? 0})`);
  if (!project.files?.length) {
    lines.push('  - none');
  } else {
    for (const filePath of project.files) {
      const summary = canopy.files[filePath]?.summary;
      lines.push(`  - ${filePath}${summary ? ` — ${truncate(summary, 100)}` : ''}`);
    }
  }

  if (project.openQuestions?.length) {
    lines.push('', 'Open questions');
    for (const question of project.openQuestions) lines.push(`  - ${question}`);
  }

  lines.push('', `Project TODOs (${project.todos?.length ?? 0})`);
  const todos = project.todos ?? [];
  if (todos.length === 0) {
    lines.push('  - none');
  } else {
    for (const todo of todos) {
      lines.push(`  - ${todo.id} P${todo.priority} [${todo.status}] ${todo.text}`);
    }
  }

  const recent = manifest?.entries
    .filter(entry => entry.projectId === key || entry.projectId === project.id)
    .slice(-5)
    .reverse();
  if (recent?.length) {
    lines.push('', 'Recent project activity');
    for (const entry of recent) {
      lines.push(`  - ${entry.id} [${entry.status}] ${entry.headline ?? entry.kind ?? 'activity'}`);
    }
  }

  return lines.join('\n');
}

function run(): void {
  const { values, positionals } = parseArgs({
    options: {
      ...CORE_OPTIONS,
      status: { type: 'string' },
      all: { type: 'boolean', short: 'a' },
      limit: { type: 'string', short: 'n' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag projects [project] — list projects or show one project\n\nOptions:\n  -r, --repo <path>       Repo root (default: cwd)\n      --status <status>    active, paused, or done\n  -n, --limit <count>     Max list results (default: 20)\n  -a, --all               Include completed projects\n  -h, --help              Show this help`);
    return;
  }

  const status = values.status as Project['status'] | undefined;
  if (status && !['active', 'paused', 'done'].includes(status)) {
    console.error('Invalid status: must be active, paused, or done');
    process.exit(1);
  }
  const canopy = readCanopy(resolveCanopyPath(values.repo as string | undefined));
  try {
    console.log(positionals[0]
      ? buildProjectDetail(canopy, positionals[0])
      : buildProjects(canopy, {
          status,
          all: values.all as boolean | undefined,
          limit: parseInt(values.limit as string, 10) || undefined,
        }));
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.endsWith('projects.ts') || process.argv[1]?.endsWith('projects.js');
if (isDirectRun) run();
