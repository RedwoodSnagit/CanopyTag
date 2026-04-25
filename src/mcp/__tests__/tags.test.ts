import { describe, it, expect } from 'vitest';
import { collectTags, searchTags, findDuplicates, buildTags } from '../tools/tags.js';
import type { Canopy } from '../../shared/types.js';

const mockCanopy: Canopy = {
  version: 1,
  repoRoot: '.',
  lastModifiedAt: '',
  files: {
    'a.ts': { tags: ['auth', 'backend', 'security'] } as any,
    'b.ts': { tags: ['auth', 'frontend'] } as any,
    'c.ts': { tags: ['ride_analysis', 'physics'] } as any,
    'd.ts': { tags: ['ride-analysis', 'physcs'] } as any,  // typo + separator variant
  },
  features: {},
};

describe('collectTags', () => {
  it('counts tag usage across all files', () => {
    const tags = collectTags(mockCanopy);
    expect(tags.get('auth')).toBe(2);
    expect(tags.get('backend')).toBe(1);
    expect(tags.get('ride_analysis')).toBe(1);
  });
});

describe('searchTags', () => {
  it('filters by substring', () => {
    const tags = collectTags(mockCanopy);
    const results = searchTags(tags, 'ri');
    const names = results.map(([name]) => name);
    expect(names).toContain('ride_analysis');
    expect(names).toContain('ride-analysis');
    expect(names).not.toContain('auth');
  });

  it('returns top N by count when no search', () => {
    const tags = collectTags(mockCanopy);
    const results = searchTags(tags, undefined, 2);
    expect(results.length).toBe(2);
    expect(results[0][0]).toBe('auth');  // highest count
  });
});

describe('findDuplicates', () => {
  it('detects separator variants', () => {
    const tags = collectTags(mockCanopy);
    const dupes = findDuplicates(tags);
    const pairs = dupes.map(([a, b]) => [a, b].sort().join(','));
    expect(pairs).toContain('ride-analysis,ride_analysis');
  });

  it('detects Levenshtein distance <= 2 typos', () => {
    const tags = collectTags(mockCanopy);
    const dupes = findDuplicates(tags);
    const pairs = dupes.map(([a, b]) => [a, b].sort().join(','));
    expect(pairs).toContain('physcs,physics');
  });
});

describe('buildTags', () => {
  it('returns formatted tag list', () => {
    const result = buildTags(mockCanopy);
    expect(result).toContain('auth');
    expect(result).toContain('tags');
  });

  it('filters by search term', () => {
    const result = buildTags(mockCanopy, 'auth');
    expect(result).toContain('auth');
    expect(result).not.toContain('physics');
  });

  it('shows duplicate warnings', () => {
    const result = buildTags(mockCanopy);
    expect(result).toContain('duplicate');
  });
});
