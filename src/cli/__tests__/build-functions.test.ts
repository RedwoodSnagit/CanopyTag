import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCanopy } from '../../backend/lib/canopy.js';
import { resolveCanopyPath } from '../shared.js';

const FIXTURE = resolveCanopyPath();

describe('buildStats', () => {
  it('returns a string with file counts', async () => {
    const { buildStats } = await import('../stats.js');
    const canopy = readCanopy(FIXTURE);
    const result = buildStats(canopy, {});
    expect(typeof result).toBe('string');
    expect(result).toContain('files');
  });

  it('reads hot files from the requested repo root', async () => {
    const { buildStats } = await import('../stats.js');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canopytag-stats-'));
    const canopyDir = path.join(repoRoot, 'canopytag');
    fs.mkdirSync(canopyDir, { recursive: true });
    fs.writeFileSync(path.join(canopyDir, 'canopy.json'), JSON.stringify({ version: 1, files: {} }));
    fs.writeFileSync(path.join(canopyDir, '.analytics.json'), JSON.stringify({
      version: 1,
      files: {
        'demo-only.ts': {
          total: { readCount: 3, editCount: 0, writeCount: 0, canopyQueryCount: 0 },
          days: {
            [new Date().toISOString().slice(0, 10)]: { readCount: 3 },
          },
          firstAccessedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      },
      daily: {},
    }));

    const result = buildStats({
      version: 1,
      repoRoot,
      lastModifiedAt: new Date().toISOString(),
      files: {
        'annotated.ts': { summary: 'Fixture file' },
      },
      features: {},
    }, {}, repoRoot);

    expect(result).toContain('demo-only.ts');
  });
});

describe('buildLs', () => {
  it('returns a string with file table', async () => {
    const { buildLs } = await import('../ls.js');
    const canopy = readCanopy(FIXTURE);
    const result = buildLs(canopy, {}, 'authority', 10);
    expect(typeof result).toBe('string');
    expect(result).toContain('FILE');  // header
    expect(result).toContain('REVIEW');
  });
});

describe('buildQuery', () => {
  it('returns query results', async () => {
    const { buildQuery } = await import('../query.js');
    const canopy = readCanopy(FIXTURE);
    const result = buildQuery(canopy, {}, { detail: 2, limit: 5 });
    expect(typeof result.text).toBe('string');
    expect(Array.isArray(result.matchedPaths)).toBe(true);
  });
});

describe('buildHealth', () => {
  it('returns a string', async () => {
    const { buildHealth } = await import('../health.js');
    const canopy = readCanopy(FIXTURE);
    const result = buildHealth(canopy, {}, false);
    expect(typeof result).toBe('string');
  });
});

describe('buildTodos', () => {
  it('returns a string with TODO rows', async () => {
    const { buildTodos } = await import('../todos.js');
    const canopy = readCanopy(FIXTURE);
    const result = buildTodos(canopy, {});
    expect(typeof result).toBe('string');
  });
});
