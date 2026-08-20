import { describe, expect, it } from 'vitest';
import type { Canopy } from '../../shared/types.js';
import { buildContext } from '../context.js';
import { buildProjectDetail, buildProjects, findProject } from '../projects.js';
import { buildQuery } from '../query.js';
import { buildStats } from '../stats.js';
import { buildTodos, collectTodos } from '../todos.js';

const canopy: Canopy = {
  version: 1,
  repoRoot: '',
  lastModifiedAt: '2026-08-20T00:00:00Z',
  files: {
    'src/a.ts': { summary: 'Primary implementation.', featureId: 'core' },
    'src/b.ts': { summary: 'Unrelated implementation.', featureId: 'other' },
  },
  features: { core: { name: 'Core' }, other: { name: 'Other' } },
  projects: {
    'PRJ-001': {
      id: 'PRJ-001',
      name: 'Project context layer',
      description: 'Make multi-file work traversable without a board.',
      status: 'active',
      featureIds: ['core'],
      files: ['src/a.ts'],
      openQuestions: ['Should completed projects stay visible by default?'],
      todos: [{
        id: 'RT-010',
        text: 'Validate project-scoped retrieval',
        priority: 2,
        status: 'open',
        createdAt: '2026-08-20T00:00:00Z',
        createdBy: { role: 'agent', name: 'ChatGPT 5.6 Sol' },
      }],
      createdAt: '2026-08-20T00:00:00Z',
      createdBy: { role: 'human', name: 'jeff' },
    },
    'PRJ-002': {
      id: 'PRJ-002',
      name: 'Finished work',
      status: 'done',
      files: ['src/b.ts'],
      createdAt: '2026-08-19T00:00:00Z',
      createdBy: 'human',
      completedAt: '2026-08-20T00:00:00Z',
    },
  },
};

describe('project reads', () => {
  it('lists active projects by default and resolves a unique name substring', () => {
    expect(buildProjects(canopy)).toContain('PRJ-001');
    expect(buildProjects(canopy)).not.toContain('PRJ-002');
    expect(findProject(canopy, 'context')[1].id).toBe('PRJ-001');
  });

  it('renders why, files, questions, and project-owned TODOs', () => {
    const output = buildProjectDetail(canopy, 'PRJ-001');
    expect(output).toContain('Make multi-file work traversable');
    expect(output).toContain('src/a.ts');
    expect(output).toContain('Should completed projects');
    expect(output).toContain('RT-010');
  });

  it('shows project context and inherited project TODOs from an implicated file', () => {
    const output = buildContext(canopy, { file: 'src/a.ts' });
    expect(output).toContain('Projects: PRJ-001 Project context layer');
    expect(output).toContain('Project TODOs (inherited): RT-010');
  });

  it('restricts direct query results to project files and includes project intent', () => {
    const output = buildQuery(canopy, {}, { project: 'PRJ-001', detail: 2 }).text;
    expect(output).toContain('PRJ-001 — Project context layer');
    expect(output).toContain('src/a.ts');
    expect(output).not.toContain('src/b.ts');
    expect(output).toContain('── project TODOs ──');
  });

  it('labels project TODO scope without copying it to a file card', () => {
    const rows = collectTodos(canopy);
    const projectTodo = rows.find(row => row.id === 'RT-010');
    expect(projectTodo).toMatchObject({ scope: 'PRJ-001', scopeKind: 'project' });
    expect(canopy.files['src/a.ts'].todos).toBeUndefined();
    expect(buildTodos(canopy, {}, { project: 'PRJ-001' })).toContain('project');
  });

  it('keeps project-only repositories visible in orientation stats', () => {
    const output = buildStats({ ...canopy, files: {} }, {});
    expect(output).toContain('0 files');
    expect(output).toContain('Projects: 2 (1 active)');
    expect(output).toContain('Open TODOs: 1');
  });
});
