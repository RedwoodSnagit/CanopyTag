import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverRepoFiles, buildCoverage } from '../coverage.js';
import type { Canopy } from '../../shared/types.js';

function makeCanopy(files: Record<string, any>): Canopy {
  return { version: 1, repoRoot: '/test', lastModifiedAt: '', files, features: {} };
}

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctag-coverage-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function initGitRepo(dir: string, files: string[]): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  for (const f of files) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

describe('discoverRepoFiles', () => {
  it('returns tracked files from a git repo', () => {
    initGitRepo(testDir, ['src/app.ts', 'src/utils.ts', 'README.md']);
    const canopyDir = path.join(testDir, 'canopytag');
    const result = discoverRepoFiles(testDir, canopyDir);
    expect(result).toContain('src/app.ts');
    expect(result).toContain('src/utils.ts');
    expect(result).toContain('README.md');
    expect(result.size).toBe(3);
  });

  it('excludes files under the canopy directory', () => {
    initGitRepo(testDir, ['src/app.ts', 'canopytag/canopy.json', 'canopytag/settings.json']);
    const canopyDir = path.join(testDir, 'canopytag');
    const result = discoverRepoFiles(testDir, canopyDir);
    expect(result).toContain('src/app.ts');
    expect(result).not.toContain('canopytag/canopy.json');
    expect(result).not.toContain('canopytag/settings.json');
    expect(result.size).toBe(1);
  });

  it('applies .ctagignore patterns', () => {
    initGitRepo(testDir, ['src/app.ts', 'generated/output.js', '.ctagignore']);
    // Write .ctagignore to exclude generated/
    fs.writeFileSync(path.join(testDir, '.ctagignore'), 'generated/\n');
    const canopyDir = path.join(testDir, 'canopytag');
    const result = discoverRepoFiles(testDir, canopyDir);
    expect(result).toContain('src/app.ts');
    expect(result).not.toContain('generated/output.js');
  });

  it('throws on non-git directory', () => {
    // Use a temp dir outside any git repo
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'ctag-nogit-'));
    try {
      expect(() => discoverRepoFiles(isolated, path.join(isolated, 'canopytag')))
        .toThrow(/git repository/i);
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('normalizes backslashes to forward slashes', () => {
    initGitRepo(testDir, ['src/nested/file.ts']);
    const canopyDir = path.join(testDir, 'canopytag');
    const result = discoverRepoFiles(testDir, canopyDir);
    // git ls-files returns forward slashes, but verify normalization
    for (const p of result) {
      expect(p).not.toContain('\\');
    }
  });
});

describe('buildCoverage', () => {
  it('counts unannotated, annotated, and orphaned correctly', () => {
    const canopy = makeCanopy({
      'src/a.ts': { summary: 'A' },
      'src/b.ts': { summary: 'B' },
      'gone.ts': { summary: 'orphan' },
    });
    const repoFiles = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    const { result } = buildCoverage(canopy, repoFiles);

    expect(result.annotated).toBe(2);
    expect(result.unannotated).toBe(2);
    expect(result.orphaned).toBe(1);
    expect(result.orphanedFiles).toEqual(['gone.ts']);
    expect(result.total).toBe(4);
  });

  it('groups unannotated files by kind', () => {
    const canopy = makeCanopy({});
    const repoFiles = new Set(['src/app.ts', 'src/utils.ts', 'README.md', 'docs/guide.md', 'config.json']);
    const { result } = buildCoverage(canopy, repoFiles);

    expect(result.byKind['module']).toEqual({ annotated: 0, unannotated: 2 });
    expect(result.byKind['doc']).toEqual({ annotated: 0, unannotated: 2 });
    expect(result.byKind['config']).toEqual({ annotated: 0, unannotated: 1 });
  });

  it('returns empty results for empty inputs', () => {
    const canopy = makeCanopy({});
    const repoFiles = new Set<string>();
    const { result } = buildCoverage(canopy, repoFiles);

    expect(result.total).toBe(0);
    expect(result.annotated).toBe(0);
    expect(result.unannotated).toBe(0);
    expect(result.orphaned).toBe(0);
  });

  it('applies kind filter to counts but not to orphans', () => {
    const canopy = makeCanopy({
      'src/a.ts': { summary: 'A' },
      'gone.md': { summary: 'orphan doc' },
    });
    const repoFiles = new Set(['src/a.ts', 'src/b.ts', 'README.md']);
    const { result } = buildCoverage(canopy, repoFiles, 'module');

    // Only modules counted
    expect(result.total).toBe(2);     // src/a.ts, src/b.ts
    expect(result.annotated).toBe(1); // src/a.ts
    expect(result.unannotated).toBe(1); // src/b.ts
    // Orphans always surfaced regardless of filter
    expect(result.orphaned).toBe(1);
    expect(result.orphanedFiles).toEqual(['gone.md']);
  });

  it('text output includes percentage and orphan list', () => {
    const canopy = makeCanopy({
      'src/a.ts': { summary: 'A' },
      'gone.ts': { summary: 'orphan' },
    });
    const repoFiles = new Set(['src/a.ts', 'src/b.ts']);
    const { text } = buildCoverage(canopy, repoFiles);

    expect(text).toContain('1/2');
    expect(text).toContain('50%');
    expect(text).toContain('gone.ts');
    expect(text).toContain('Orphaned');
  });

  it('detail mode shows field coverage sorted by least complete', () => {
    const canopy = makeCanopy({
      'src/full.ts': {
        summary: 'Full',
        tags: ['core'],
        validity: 4, clarity: 4, completeness: 4, stability: 4,
        authorityLevel: 'guideline',
        relatedFiles: [{ path: 'src/other.ts', relationType: 'depends-on' }],
      },
      'src/partial.ts': {
        summary: 'Partial',
      },
      'src/empty.ts': {},
    });
    const repoFiles = new Set(['src/full.ts', 'src/partial.ts', 'src/empty.ts']);
    const { result } = buildCoverage(canopy, repoFiles, undefined, true);

    expect(result.fieldCoverage).toBeDefined();
    expect(result.fieldCoverage!.length).toBe(3);
    // Least complete first
    expect(result.fieldCoverage![0].path).toBe('src/empty.ts');
    expect(result.fieldCoverage![0].missing).toContain('summary');
    // Most complete last
    expect(result.fieldCoverage![2].path).toBe('src/full.ts');
    expect(result.fieldCoverage![2].missing).toEqual([]);
  });
});
