import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { Canopy, Feature } from '../../shared/types';
import { featuresRoutes } from '../routes/features';

const TEST_DIR = path.join(import.meta.dirname, '__test_features_routes_workspace__');
const openApps: FastifyInstance[] = [];

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(app => app.close()));
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function createApp(features: Record<string, Feature>) {
  const app = Fastify({ logger: false });
  const canopyPath = path.join(TEST_DIR, 'canopy.json');
  const canopy: Canopy = {
    version: 1,
    repoRoot: TEST_DIR,
    lastModifiedAt: '',
    files: {},
    features,
  };

  app.decorate('serverState', {
    repoRoot: TEST_DIR,
    canopyPath,
    canopy,
    repoIndex: new Map(),
    tags: [],
    settings: { archiveRetention: 'off' as const },
    settingsPath: path.join(TEST_DIR, 'settings.json'),
    profile: {
      version: 1,
      currentAuthor: { role: 'human' as const, name: 'Test Reviewer' },
    },
    profilePath: path.join(TEST_DIR, 'profile.local.json'),
    archivePath: path.join(TEST_DIR, 'canopy_archive.json'),
    analyticsPath: path.join(TEST_DIR, '.analytics.json'),
  });
  await app.register(featuresRoutes);
  openApps.push(app);

  return { app, canopyPath };
}

describe('feature routes', () => {
  it('preserves rich feature fields omitted by a narrower update payload', async () => {
    const { app, canopyPath } = await createApp({
      routing: {
        name: 'Routing',
        description: 'Old description',
        tags: ['old-tag'],
        status: 'active',
        canonicalFile: 'docs/routing.md',
        owners: [{ role: 'human', name: 'Feature Owner' }],
        openQuestions: ['Which route should be canonical?'],
        promotionStatus: 'endorsed',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/features',
      payload: {
        id: 'routing',
        name: 'Routing v2',
        description: 'Replacement description',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'Routing v2',
      description: 'Replacement description',
      canonicalFile: 'docs/routing.md',
      owners: [{ role: 'human', name: 'Feature Owner' }],
      openQuestions: ['Which route should be canonical?'],
      promotionStatus: 'endorsed',
    });

    const persisted = JSON.parse(fs.readFileSync(canopyPath, 'utf-8'));
    expect(persisted.features.routing).toEqual({
      name: 'Routing v2',
      description: 'Replacement description',
      canonical_file: 'docs/routing.md',
      owners: [{ role: 'human', name: 'Feature Owner' }],
      open_questions: ['Which route should be canonical?'],
      promotion_status: 'endorsed',
    });
  });

  it('accepts explicit camelCase updates for every supported rich field', async () => {
    const { app, canopyPath } = await createApp({
      routing: {
        name: 'Routing',
        canonicalFile: 'docs/old.md',
        owners: ['human'],
        openQuestions: ['Old question'],
        promotionStatus: 'seed',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/features',
      payload: {
        id: 'routing',
        name: 'Routing',
        canonicalFile: 'src/routing.ts',
        owners: [{ role: 'agent', name: 'codex', session: 'route-test' }],
        openQuestions: [],
        promotionStatus: 'retired',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'Routing',
      canonicalFile: 'src/routing.ts',
      owners: [{ role: 'agent', name: 'codex', session: 'route-test' }],
      openQuestions: [],
      promotionStatus: 'retired',
    });

    const persisted = JSON.parse(fs.readFileSync(canopyPath, 'utf-8'));
    expect(persisted.features.routing).toEqual({
      name: 'Routing',
      canonical_file: 'src/routing.ts',
      owners: [{ role: 'agent', name: 'codex', session: 'route-test' }],
      open_questions: [],
      promotion_status: 'retired',
    });
  });
});
