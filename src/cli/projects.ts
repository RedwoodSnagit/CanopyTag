#!/usr/bin/env node
/**
 * canopytag projects — thin multi-file work/context umbrellas
 *
 * Projects connect intent, features, files, questions, and project-owned
 * TODOs. They are deliberately not boards, sprints, or nested task trees.
 */

import { parseArgs } from 'node:util';
import { readActiveWork, resolveActiveWorkPath } from '../backend/lib/active-work.js';
import { readAgentManifest, resolveAgentManifestPath } from '../backend/lib/agent-manifest.js';
import { readCanopy } from '../backend/lib/canopy.js';
import { countTaskReadiness, resolveProjectTaskReadiness } from '../shared/project-tasks.js';
import type { AgentManifest, Author, Canopy, Project, WorkClaim } from '../shared/types.js';
import { normalizeAuthor } from '../shared/types.js';
import { CORE_OPTIONS, resolveCanopyPath, resolveRepoRoot, truncate } from './shared.js';

export interface ProjectRow {
  id: string;
  name: string;
  status: Project['status'];
  owners: string;
  features: string;
  files: number;
  openTodos: number;
  readyTasks: number;
  blockedTasks: number;
  claimedTasks: number;
  milestones: number;
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
  claims: WorkClaim[] = [],
): ProjectRow[] {
  return Object.values(canopy.projects ?? {})
    .filter(project => opts.all || opts.status !== undefined || project.status !== 'done')
    .filter(project => !opts.status || project.status === opts.status)
    .map(project => {
      const readiness = countTaskReadiness(resolveProjectTaskReadiness(project, claims));
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        owners: (project.owners ?? []).map(formatAuthor).join(', ') || '-',
        features: compactList(project.featureIds),
        files: project.files?.length ?? 0,
        openTodos: (project.todos ?? []).filter(todo => todo.status === 'open' || todo.status === 'in_progress').length,
        readyTasks: readiness.ready,
        blockedTasks: readiness.blocked,
        claimedTasks: readiness.claimed,
        milestones: project.milestones?.length ?? 0,
      };
    })
    .sort((a, b) => {
      const rank = { active: 0, paused: 1, done: 2 };
      return rank[a.status] - rank[b.status] || a.id.localeCompare(b.id);
    });
}

export function buildProjects(
  canopy: Canopy,
  opts: { status?: Project['status']; all?: boolean; limit?: number } = {},
  claims: WorkClaim[] = [],
): string {
  const rows = collectProjects(canopy, opts, claims);
  if (rows.length === 0) return 'No projects match.';

  const limit = opts.limit ?? 20;
  const shown = rows.slice(0, limit);
  const nameWidth = Math.min(36, Math.max(4, ...shown.map(row => row.name.length)));
  const lines = [
    `${'ID'.padEnd(9)}  ${'STATUS'.padEnd(7)}  ${'NAME'.padEnd(nameWidth)}  ${'FILES'.padStart(5)}  ${'OPEN'.padStart(4)}  ${'READY'.padStart(5)}  ${'BLOCK'.padStart(5)}  FEATURES`,
    '-'.repeat(9 + 2 + 7 + 2 + nameWidth + 2 + 5 + 2 + 4 + 2 + 5 + 2 + 5 + 2 + 8),
  ];
  for (const row of shown) {
    lines.push(
      `${row.id.padEnd(9)}  ${row.status.padEnd(7)}  ${truncate(row.name, nameWidth).padEnd(nameWidth)}  ${String(row.files).padStart(5)}  ${String(row.openTodos).padStart(4)}  ${String(row.readyTasks).padStart(5)}  ${String(row.blockedTasks).padStart(5)}  ${row.features}`
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
  claims: WorkClaim[] = [],
): string {
  const [key, project] = findProject(canopy, ref);
  const taskReadiness = resolveProjectTaskReadiness(project, claims);
  const readinessByTask = new Map(taskReadiness.map(item => [item.taskId, item]));
  const readinessCounts = countTaskReadiness(taskReadiness);
  const lines = [
    `${project.id} — ${project.name}`,
    `Status: ${project.status}`,
  ];
  if (project.description) lines.push(`Why: ${project.description}`);
  if (project.owners?.length) lines.push(`Owners: ${project.owners.map(formatAuthor).join(', ')}`);
  if (project.featureIds?.length) lines.push(`Features: ${project.featureIds.join(', ')}`);
  if (project.createdAt) lines.push(`Created: ${project.createdAt} by ${formatAuthor(project.createdBy)}`);
  if (project.completedAt) lines.push(`Completed: ${project.completedAt}`);
  lines.push(`Readiness: ${readinessCounts.ready} ready, ${readinessCounts.blocked} blocked, ${readinessCounts.claimed} claimed`);

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

  if (project.milestones?.length) {
    lines.push('', `Milestones (${project.milestones.length})`);
    for (const milestone of project.milestones) {
      const timing = milestone.completedAt
        ? `completed ${milestone.completedAt}`
        : milestone.targetAt ? `target ${milestone.targetAt}` : 'open anchor';
      lines.push(`  - ${milestone.id} [${timing}] ${milestone.name}`);
      if (milestone.description) lines.push(`    ${milestone.description}`);
    }
  }

  lines.push('', `Project tasks / TODOs (${project.todos?.length ?? 0})`);
  const todos = project.todos ?? [];
  if (todos.length === 0) {
    lines.push('  - none');
  } else {
    for (const todo of todos) {
      const readiness = readinessByTask.get(todo.id);
      lines.push(`  - ${todo.id} P${todo.priority} [${readiness?.state ?? todo.status}] ${todo.text}`);
      if (todo.whyNow) lines.push(`    Why now: ${todo.whyNow}`);
      if (todo.milestoneId) lines.push(`    Milestone: ${todo.milestoneId}`);
      if (todo.owners?.length) lines.push(`    Owners: ${todo.owners.map(formatAuthor).join(', ')}`);
      if (todo.reviewers?.length) lines.push(`    Reviewers: ${todo.reviewers.map(formatAuthor).join(', ')}`);
      if (todo.dependencies?.length) {
        lines.push(`    Dependencies: ${todo.dependencies.map(edge => `${edge.type} ${edge.taskId}${edge.reason ? ` (${edge.reason})` : ''}`).join('; ')}`);
      }
      if (todo.ownedPaths?.length) lines.push(`    Owned paths: ${todo.ownedPaths.join(', ')}`);
      if (todo.excludedPaths?.length) lines.push(`    Exclusions: ${todo.excludedPaths.join(', ')}`);
      if (todo.resources?.length) {
        lines.push('    Resources:');
        for (const resource of todo.resources) {
          lines.push(`      - ${resource.role} ${resource.kind}: ${resource.ref}${resource.label ? ` — ${resource.label}` : ''}`);
        }
      }
      if (todo.acceptance?.length) {
        lines.push('    Acceptance:');
        for (const criterion of todo.acceptance) lines.push(`      - ${criterion}`);
      }
      if (todo.openQuestions?.length) {
        lines.push('    Required decisions:');
        for (const question of todo.openQuestions) lines.push(`      - ${question}`);
      }
      const readinessBlockers = readiness?.blockers.filter(blocker => blocker.kind !== 'claim') ?? [];
      const activeClaims = readiness?.blockers.filter(blocker => blocker.kind === 'claim') ?? [];
      if (readinessBlockers.length) lines.push(`    Readiness blockers: ${readinessBlockers.map(blocker => blocker.message).join('; ')}`);
      if (activeClaims.length) lines.push(`    Active claims: ${activeClaims.map(blocker => blocker.message).join('; ')}`);
      if (todo.receipts?.length) {
        lines.push('    Receipts:');
        for (const receipt of todo.receipts) {
          lines.push(`      - ${receipt.id} ${receipt.kind}/${receipt.outcome} ${receipt.recordedAt} by ${formatAuthor(receipt.actor)} — ${receipt.summary}`);
          if (receipt.residualRisk) lines.push(`        Residual risk: ${receipt.residualRisk}`);
        }
      }
      if (todo.residualRisks?.length) lines.push(`    Residual risks: ${todo.residualRisks.join('; ')}`);
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
  const repoOption = values.repo as string | undefined;
  const repoRoot = resolveRepoRoot(repoOption);
  const canopy = readCanopy(resolveCanopyPath(repoOption));
  const manifest = readAgentManifest(resolveAgentManifestPath(repoRoot));
  const claims = readActiveWork(resolveActiveWorkPath(repoRoot)).claims;
  try {
    console.log(positionals[0]
      ? buildProjectDetail(canopy, positionals[0], manifest, claims)
      : buildProjects(canopy, {
          status,
          all: values.all as boolean | undefined,
          limit: parseInt(values.limit as string, 10) || undefined,
        }, claims));
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.endsWith('projects.ts') || process.argv[1]?.endsWith('projects.js');
if (isDirectRun) run();
