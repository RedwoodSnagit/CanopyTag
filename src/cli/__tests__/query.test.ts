import { describe, expect, it } from 'vitest';
import { buildQuery } from '../query';
import type { Canopy } from '../../shared/types';

const GRAPH_CANOPY: Canopy = {
  version: 1,
  repoRoot: '.',
  lastModifiedAt: '2026-04-24T00:00:00Z',
  files: {
    'src/a.ts': {
      summary: 'Entry point for the feature.',
      authorityLevel: 'specification',
      status: 'active',
      featureId: 'engine',
      relatedFiles: [
        { path: 'src/b.ts', closeness: 4, relation: 'implements' },
      ],
    },
    'src/b.ts': {
      summary: 'Middle layer.',
      authorityLevel: 'guideline',
      status: 'active',
      relatedFiles: [
        { path: 'src/c.ts', closeness: 4, relation: 'test-of' },
      ],
    },
    'src/c.ts': {
      summary: 'Second-hop file.',
      authorityLevel: 'idea',
      status: 'active',
    },
  },
  features: {
    engine: {
      name: 'Engine',
      description: 'Feature graph test fixture.',
    },
  },
};

describe('buildQuery connection traversal', () => {
  it('keeps detail 2 compact with one-hop connections', () => {
    const result = buildQuery(GRAPH_CANOPY, { feature: 'engine' }, { detail: 2 });

    expect(result.text).toContain('src/a.ts');
    expect(result.text).toContain('src/b.ts');
    expect(result.text).not.toContain('src/c.ts');
    expect(result.matchedPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('walks connections-of-connections at detail 3 and above', () => {
    const result = buildQuery(GRAPH_CANOPY, { feature: 'engine' }, { detail: 3 });

    expect(result.text).toContain('src/c.ts');
    expect(result.text).toContain('hop 2 via src/b.ts');
    expect(result.matchedPaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('applies relation filters to every traversal hop', () => {
    const result = buildQuery(GRAPH_CANOPY, { feature: 'engine' }, {
      detail: 3,
      relation: 'implements',
    });

    expect(result.text).toContain('src/b.ts');
    expect(result.text).not.toContain('src/c.ts');
    expect(result.matchedPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
