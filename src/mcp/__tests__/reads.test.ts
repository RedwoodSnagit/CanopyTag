import { describe, it, expect, beforeAll } from 'vitest';
import { readCanopy } from '../../backend/lib/canopy.js';
import { resolveCanopyPath } from '../../cli/shared.js';
import { buildStats } from '../../cli/stats.js';
import { buildLs } from '../../cli/ls.js';
import { buildQuery } from '../../cli/query.js';
import { buildContext } from '../../cli/context.js';
import { buildCompare } from '../../cli/compare.js';
import { buildHealth } from '../../cli/health.js';
import { buildTodos } from '../../cli/todos.js';
import { buildTags } from '../tools/tags.js';
import { discoverRepoFiles, buildCoverage } from '../../cli/coverage.js';
import { resolveRepoRoot } from '../../cli/shared.js';
import path from 'node:path';
import type { Canopy } from '../../shared/types.js';

let canopy: Canopy;

beforeAll(() => {
  const fixture = resolveCanopyPath();
  canopy = readCanopy(fixture);
});

describe('MCP read tool integration', () => {
  it('buildStats returns text with file counts', () => {
    const result = buildStats(canopy, {});
    expect(typeof result).toBe('string');
    expect(result).toContain('files');
  });

  it('buildStats filters by feature', () => {
    // Use a feature that exists in the fixture, or just verify it doesn't crash
    const result = buildStats(canopy, { feature: 'cli-tools' });
    expect(typeof result).toBe('string');
  });

  it('buildLs returns table with FILE header', () => {
    const result = buildLs(canopy, {}, 'authority', 10);
    expect(result).toContain('FILE');
    expect(result).toContain('REVIEW');
  });

  it('buildQuery returns query results', () => {
    const result = buildQuery(canopy, {}, { detail: 2, limit: 5 });
    expect(typeof result.text).toBe('string');
    expect(Array.isArray(result.matchedPaths)).toBe(true);
  });

  it('buildHealth returns health report', () => {
    const result = buildHealth(canopy, {}, false);
    expect(typeof result).toBe('string');
  });

  it('buildTodos returns todo list', () => {
    const result = buildTodos(canopy, {});
    expect(typeof result).toBe('string');
  });

  it('buildTags returns tag list', () => {
    const result = buildTags(canopy);
    expect(result).toMatch(/tags/i);
  });

  it('buildContext returns context for feature', () => {
    const result = buildContext(canopy, { feature: 'cli-tools' });
    expect(typeof result).toBe('string');
  });

  it('buildCompare returns comparison text and matched paths', () => {
    const firstFiles = Object.keys(canopy.files).slice(0, 2);
    const result = buildCompare(canopy, firstFiles);
    expect(result.text).toContain('Authority is conflict precedence');
    expect(result.text).toContain('Trust order:');
    expect(result.matchedPaths.length).toBe(firstFiles.length);
  });

  it('buildCoverage returns coverage report with annotated count', () => {
    const repoRoot = resolveRepoRoot();
    const canopyPath = resolveCanopyPath();
    const canopyDir = path.dirname(canopyPath);
    const repoFiles = discoverRepoFiles(repoRoot, canopyDir);
    const { text, result } = buildCoverage(canopy, repoFiles);
    expect(text).toContain('Coverage:');
    expect(text).toContain('annotated');
    expect(result.total).toBeGreaterThan(0);
    expect(result.annotated + result.unannotated).toBe(result.total);
  });
});
