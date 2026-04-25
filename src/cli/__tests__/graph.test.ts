import { describe, it, expect } from 'vitest';
import { buildReverseIndex, walkGraph, renderGraphTree } from '../graph.js';
import type { Canopy } from '../../shared/types.js';

function makeCanopy(files: Canopy['files']): Canopy {
  return {
    version: 1,
    repoRoot: '/test',
    lastModifiedAt: '2026-04-03T00:00:00Z',
    files,
    features: {},
  };
}

describe('buildReverseIndex', () => {
  it('builds reverse entries from relatedFiles', () => {
    const canopy = makeCanopy({
      'src/auth.ts': {
        summary: 'Auth',
        relatedFiles: [
          { path: 'src/types.ts', closeness: 4, relation: 'fed-by' },
          'docs/auth-spec.md',
        ],
      },
      'tests/auth.test.ts': {
        summary: 'Auth tests',
        relatedFiles: [
          { path: 'src/auth.ts', closeness: 5, relation: 'test-of' },
        ],
      },
    });

    const index = buildReverseIndex(canopy);

    const typesEntries = index.get('src/types.ts');
    expect(typesEntries).toHaveLength(1);
    expect(typesEntries![0]).toEqual({
      source: 'src/auth.ts',
      closeness: 4,
      relation: 'fed-by',
    });

    const specEntries = index.get('docs/auth-spec.md');
    expect(specEntries).toHaveLength(1);
    expect(specEntries![0]).toEqual({
      source: 'src/auth.ts',
      closeness: 3,
      relation: undefined,
    });

    const authEntries = index.get('src/auth.ts');
    expect(authEntries).toHaveLength(1);
    expect(authEntries![0]).toEqual({
      source: 'tests/auth.test.ts',
      closeness: 5,
      relation: 'test-of',
    });
  });

  it('normalizes paths (backslash, leading ./)', () => {
    const canopy = makeCanopy({
      'src/auth.ts': {
        summary: 'Auth',
        relatedFiles: [
          { path: '.\\src\\types.ts', closeness: 4 },
          './docs/spec.md',
        ],
      },
    });

    const index = buildReverseIndex(canopy);
    expect(index.get('src/types.ts')).toHaveLength(1);
    expect(index.get('docs/spec.md')).toHaveLength(1);
  });

  it('returns empty map for canopy with no relations', () => {
    const canopy = makeCanopy({
      'src/auth.ts': { summary: 'Auth' },
    });
    const index = buildReverseIndex(canopy);
    expect(index.size).toBe(0);
  });
});

// Shared test canopy: A → B → C (forward chain), D → A (D depends on A)
function makeGraphCanopy(): Canopy {
  return makeCanopy({
    'src/a.ts': {
      summary: 'Module A',
      relatedFiles: [
        { path: 'src/b.ts', closeness: 4, relation: 'implements' },
      ],
    },
    'src/b.ts': {
      summary: 'Module B',
      relatedFiles: [
        { path: 'src/c.ts', closeness: 3, relation: 'fed-by' },
      ],
    },
    'src/c.ts': { summary: 'Module C' },
    'src/d.ts': {
      summary: 'Module D',
      relatedFiles: [
        { path: 'src/a.ts', closeness: 5, relation: 'test-of' },
      ],
    },
  });
}

describe('walkGraph', () => {
  it('fan-out 1 hop from A returns B', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'out', 1);
    expect(tree.path).toBe('src/a.ts');
    expect(tree.hop).toBe(0);
    expect(tree.relation).toBeUndefined();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/b.ts');
    expect(tree.children[0].relation).toBe('implements');
    expect(tree.children[0].closeness).toBe(4);
    expect(tree.children[0].hop).toBe(1);
    expect(tree.children[0].children).toHaveLength(0);
  });

  it('fan-out 2 hops from A returns B → C', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'out', 2);
    expect(tree.children).toHaveLength(1);
    const b = tree.children[0];
    expect(b.children).toHaveLength(1);
    expect(b.children[0].path).toBe('src/c.ts');
    expect(b.children[0].hop).toBe(2);
  });

  it('fan-in 1 hop to A returns D', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'in', 1);
    expect(tree.path).toBe('src/a.ts');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/d.ts');
    expect(tree.children[0].relation).toBe('test-of');
    expect(tree.children[0].closeness).toBe(5);
  });

  it('fan-in 2 hops to B returns A (via reverse) then D (via reverse of A)', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/b.ts', 'in', 2);
    expect(tree.children).toHaveLength(1);
    const a = tree.children[0];
    expect(a.path).toBe('src/a.ts');
    expect(a.children).toHaveLength(1);
    expect(a.children[0].path).toBe('src/d.ts');
  });

  it('respects minCloseness filter', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'out', 2, { minCloseness: 4 });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/b.ts');
    expect(tree.children[0].children).toHaveLength(0);
  });

  it('respects relation filter', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'out', 2, { relation: 'fed-by' });
    expect(tree.children).toHaveLength(0);
  });

  it('handles cycles silently', () => {
    const canopy = makeCanopy({
      'src/x.ts': {
        summary: 'X',
        relatedFiles: [{ path: 'src/y.ts', closeness: 4 }],
      },
      'src/y.ts': {
        summary: 'Y',
        relatedFiles: [{ path: 'src/x.ts', closeness: 4 }],
      },
    });
    const tree = walkGraph(canopy, 'src/x.ts', 'out', 10);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/y.ts');
    expect(tree.children[0].children).toHaveLength(0);
  });

  it('accepts pre-built reverseIndex', () => {
    const canopy = makeGraphCanopy();
    const revIdx = buildReverseIndex(canopy);
    const tree = walkGraph(canopy, 'src/a.ts', 'in', 1, { reverseIndex: revIdx });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/d.ts');
  });

  it('returns leaf node for file with no relations', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/c.ts', 'out', 3);
    expect(tree.children).toHaveLength(0);
  });

  it('handles self-referencing file without infinite loop', () => {
    const canopy = makeCanopy({
      'src/self.ts': {
        summary: 'Self',
        relatedFiles: [{ path: 'src/self.ts', closeness: 5 }],
      },
    });
    const tree = walkGraph(canopy, 'src/self.ts', 'out', 5);
    expect(tree.children).toHaveLength(0);
  });
});

describe('renderGraphTree', () => {
  it('renders fan-in tree with left arrows', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'in', 1);
    const output = renderGraphTree(tree, 'in');
    expect(output).toContain('src/a.ts');
    expect(output).toContain('←');
    expect(output).toContain('src/d.ts');
    expect(output).toContain('[test-of]');
    expect(output).toContain('closeness 5');
  });

  it('renders fan-out tree with right arrows', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/a.ts', 'out', 2);
    const output = renderGraphTree(tree, 'out');
    expect(output).toContain('src/a.ts');
    expect(output).toContain('→');
    expect(output).toContain('src/b.ts');
    expect(output).toContain('[implements]');
    expect(output).toContain('src/c.ts');
  });

  it('omits relation label when untyped', () => {
    const canopy = makeCanopy({
      'src/x.ts': {
        summary: 'X',
        relatedFiles: ['src/y.ts'],
      },
      'src/y.ts': { summary: 'Y' },
    });
    const tree = walkGraph(canopy, 'src/x.ts', 'out', 1);
    const output = renderGraphTree(tree, 'out');
    expect(output).toContain('src/y.ts');
    expect(output).toContain('closeness 3');
    expect(output).not.toMatch(/\[.*\]/);
  });

  it('renders leaf node with no children', () => {
    const canopy = makeGraphCanopy();
    const tree = walkGraph(canopy, 'src/c.ts', 'out', 1);
    const output = renderGraphTree(tree, 'out');
    expect(output).toBe('src/c.ts');
  });
});
