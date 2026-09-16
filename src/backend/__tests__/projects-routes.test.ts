import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { Canopy, Todo } from '../../shared/types';
import { fileRoutes } from '../routes/file';
import { projectsRoutes } from '../routes/projects';

const TEST_DIR = path.join(import.meta.dirname, '__test_projects_routes_workspace__');
const openApps: FastifyInstance[] = [];

const todo = (id: string, status: Todo['status']): Todo => ({
  id,
  text: `${status} project task`,
  priority: 1,
  status,
  createdAt: '2026-08-20T00:00:00Z',
  createdBy: { role: 'human', name: 'Test Owner' },
});

beforeEach(() => {
  fs.mkdirSync(path.join(TEST_DIR, 'canopytag'), { recursive: true });
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(app => app.close()));
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function createApp() {
  const app = Fastify({ logger: false });
  const canopyPath = path.join(TEST_DIR, 'canopytag', 'canopy.json');
  const canopy: Canopy = {
    version: 1,
    repoRoot: '',
    lastModifiedAt: '',
    files: {
      'src/annotated.ts': { summary: 'Annotated implementation.' },
    },
    features: {
      routing: { name: 'Routing' },
    },
    projects: {
      'PRJ-001': {
        id: 'PRJ-001',
        name: 'Project routing',
        description: 'Make project context visible.',
        status: 'active',
        owners: [{ role: 'human', name: 'Test Owner' }],
        featureIds: ['routing'],
        files: ['src/annotated.ts', 'src/unannotated.ts'],
        todos: [{
          ...todo('RT-001', 'open'),
          whyNow: 'The UI needs an executable packet.',
          milestoneId: 'MS-001',
          dependencies: [{ type: 'depends_on', taskId: 'RT-003' }],
          resources: [{ kind: 'documentation', role: 'governs', ref: 'docs/design/project-layer.md' }],
          acceptance: ['The route returns computed readiness.'],
        }, todo('RT-002', 'in_progress'), todo('RT-003', 'done')],
        milestones: [{ id: 'MS-001', name: 'Execution packet contract' }],
        openQuestions: ['Does the backlink remain derived?'],
        createdAt: '2026-08-20T00:00:00Z',
        createdBy: { role: 'agent', name: 'Test Agent' },
      },
    },
  };

  app.decorate('serverState', {
    repoRoot: TEST_DIR,
    demoRoot: path.join(TEST_DIR, 'demo'),
    canopyPath,
    canopy,
    repoIndex: new Map(),
    tags: [],
    settings: { archiveRetention: 'off' as const },
    settingsPath: path.join(TEST_DIR, 'canopytag', 'settings.json'),
    profile: { version: 1, currentAuthor: { role: 'human' as const, name: 'Test Reviewer' } },
    profilePath: path.join(TEST_DIR, 'canopytag', 'profile.local.json'),
    archivePath: path.join(TEST_DIR, 'canopytag', 'canopy_archive.json'),
    analyticsPath: path.join(TEST_DIR, 'canopytag', '.analytics.json'),
  });
  await app.register(projectsRoutes);
  await app.register(fileRoutes);
  openApps.push(app);
  return { app, canopy, canopyPath };
}

describe('project routes', () => {
  it('returns count parity, complete linked-file visibility, and file backlinks', async () => {
    const { app } = await createApp();

    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({
      fileCount: 2,
      todoCount: 3,
      openTodoCount: 2,
      readyTaskCount: 1,
      blockedTaskCount: 0,
      claimedTaskCount: 0,
      milestoneCount: 1,
      project: { id: 'PRJ-001' },
    });

    const detail = await app.inject({ method: 'GET', url: '/api/project?project=PRJ-001' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/annotated.ts', annotated: true }),
      expect.objectContaining({ path: 'src/unannotated.ts', annotated: false }),
    ]));
    expect(detail.json().features[0]).toMatchObject({ id: 'routing', feature: { name: 'Routing' } });
    expect(detail.json().taskReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'RT-001', state: 'ready' }),
      expect.objectContaining({ taskId: 'RT-002', state: 'in_progress' }),
      expect.objectContaining({ taskId: 'RT-003', state: 'done' }),
    ]));

    const file = await app.inject({ method: 'GET', url: '/api/file?path=src/unannotated.ts' });
    expect(file.statusCode).toBe(200);
    expect(file.json().projects[0]).toMatchObject({
      id: 'PRJ-001',
      name: 'Project routing',
    });
    expect(file.json().projects[0].todos).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'RT-001' }),
    ]));
  });

  it('updates bounded project fields without replacing tasks or provenance', async () => {
    const { app, canopy, canopyPath } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/project',
      payload: {
        project: 'PRJ-001',
        name: 'Project routing UI',
        description: 'Visible to humans and agents.',
        status: 'done',
        files: ['src/annotated.ts'],
        featureIds: [],
        openQuestions: [],
        expectedFiles: ['src/annotated.ts', 'src/unannotated.ts'],
        expectedFeatureIds: ['routing'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().project).toMatchObject({
      id: 'PRJ-001',
      name: 'Project routing UI',
      status: 'done',
      createdBy: { role: 'agent', name: 'Test Agent' },
    });
    expect(response.json().project.todos).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'RT-001',
        dependencies: [{ type: 'depends_on', taskId: 'RT-003' }],
        resources: [{ kind: 'documentation', role: 'governs', ref: 'docs/design/project-layer.md' }],
      }),
    ]));
    expect(response.json().project.milestones).toEqual([{ id: 'MS-001', name: 'Execution packet contract' }]);
    expect(canopy.projects?.['PRJ-001'].featureIds).toBeUndefined();
    expect(canopy.projects?.['PRJ-001'].openQuestions).toBeUndefined();
    expect(canopy.projects?.['PRJ-001'].completedAt).toBeTruthy();

    const persisted = JSON.parse(fs.readFileSync(canopyPath, 'utf-8'));
    expect(persisted.projects['PRJ-001'].feature_ids).toBeUndefined();
    expect(persisted.projects['PRJ-001'].todos).toHaveLength(3);
    expect(persisted.projects['PRJ-001'].todos[0].milestone_id).toBe('MS-001');
    expect(persisted.projects['PRJ-001'].milestones).toEqual([{ id: 'MS-001', name: 'Execution packet contract' }]);
    expect(persisted.projects['PRJ-001'].completed_at).toBeTruthy();
  });

  it('rejects stale relationship replacement instead of clobbering newer links', async () => {
    const { app, canopy } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/project',
      payload: {
        project: 'PRJ-001',
        files: ['src/annotated.ts'],
        expectedFiles: ['src/stale.ts'],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('changed since');
    expect(canopy.projects?.['PRJ-001'].files).toEqual(['src/annotated.ts', 'src/unannotated.ts']);
  });

  it('requires an optimistic guard for relationship replacement', async () => {
    const { app, canopy } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/project',
      payload: { project: 'PRJ-001', files: ['src/annotated.ts'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('expectedFiles');
    expect(canopy.projects?.['PRJ-001'].files).toHaveLength(2);
  });
});
