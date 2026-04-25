import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveCanopyPath, parseBaseFilters, collectFreshnessPaths, getFreshnessStatus, freshnessLabel,
} from '../shared.js';

describe('resolveCanopyPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers canopytag/ over .canopytag/', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
    fs.mkdirSync(path.join(tmpDir, 'canopytag'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'canopytag', 'canopy.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, '.canopytag'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.canopytag', 'canopy.json'), '{}');
    const result = resolveCanopyPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, 'canopytag', 'canopy.json'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('falls back to .canopytag/ when canopytag/ does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
    fs.mkdirSync(path.join(tmpDir, '.canopytag'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.canopytag', 'canopy.json'), '{}');
    const result = resolveCanopyPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, '.canopytag', 'canopy.json'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('defaults to canopytag/ path when neither exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
    const result = resolveCanopyPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, 'canopytag', 'canopy.json'));
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('parseBaseFilters', () => {
  it('throws on invalid --kind instead of calling process.exit', () => {
    expect(() => parseBaseFilters({ kind: 'python' }))
      .toThrow('Invalid --kind');
  });

  it('throws on invalid date format', () => {
    expect(() => parseBaseFilters({ 'tagged-after': 'not-a-date' }))
      .toThrow('Invalid date');
  });

  it('parses valid filters without throwing', () => {
    const filters = parseBaseFilters({
      feature: 'auth',
      tag: 'security',
      kind: 'code',
      unreviewed: true,
      surprising: true,
    });
    expect(filters.feature).toBe('auth');
    expect(filters.tag).toBe('security');
    expect(filters.kind).toBe('module');
    expect(filters.unreviewed).toBe(true);
    expect(filters.surprising).toBe(true);
  });
});

describe('freshness helpers', () => {
  it('collects reviewed files plus close related files', () => {
    const paths = collectFreshnessPaths([
      ['docs/spec.md', {
        lastReviewed: '2026-04-19',
        relatedFiles: [
          { path: 'src/core.ts', closeness: 5 },
          { path: 'src/notes.ts', closeness: 3 },
        ],
      }],
      ['docs/unreviewed.md', {
        relatedFiles: [{ path: 'src/ignored.ts', closeness: 5 }],
      }],
    ]);
    expect(paths).toEqual(['docs/spec.md', 'src/core.ts']);
  });

  it('labels review drift when a close related file changed after review', () => {
    const status = getFreshnessStatus('docs/spec.md', {
      lastReviewed: '2026-04-19',
      relatedFiles: [{ path: 'src/core.ts', closeness: 5 }],
    }, new Map([
      ['docs/spec.md', '2026-04-18'],
      ['src/core.ts', '2026-04-20'],
    ]));
    expect(status).toBe('review-drift');
    expect(freshnessLabel(status)).toBe('Review Drift');
  });

  it('treats files with no review date as unknown', () => {
    const status = getFreshnessStatus('docs/spec.md', {}, new Map());
    expect(status).toBe('unknown');
    expect(freshnessLabel(status)).toBe('Unknown');
  });
});
