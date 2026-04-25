import { describe, expect, it } from 'vitest';
import type { MergedFileRecord } from '../../shared/types';
import {
  applyNodePositionOverrides,
  clampGraphScale,
  fitViewportToNodes,
  focusNeighborhoodFromEdges,
  mergeFocusEdges,
  orderByWeightedConnections,
  resolveFocusCenterFile,
  shouldShowFocusRelationLabel,
  zoomViewportAtPoint,
} from './GraphView';

function buildFile(path: string): MergedFileRecord {
  return {
    path,
    extension: '.ts',
    tags: [],
    todos: [],
    comments: [],
    relatedFiles: [],
    openTodoCount: 0,
  };
}

describe('resolveFocusCenterFile', () => {
  it('prefers an explicit focus path over a stale selected file', () => {
    const first = buildFile('src/old-focus.ts');
    const second = buildFile('src/new-focus.ts');
    const filesByPath = new Map([
      [first.path, first],
      [second.path, second],
    ]);

    const center = resolveFocusCenterFile([first, second], filesByPath, first, second.path);

    expect(center?.path).toBe(second.path);
  });

  it('uses the selected file when no explicit focus path is set', () => {
    const selected = buildFile('src/current.ts');
    const filesByPath = new Map([[selected.path, selected]]);

    const center = resolveFocusCenterFile([selected], filesByPath, selected, null);

    expect(center).toBe(selected);
  });

  it('falls back to the first indexed file when needed', () => {
    const first = buildFile('src/first.ts');
    const second = buildFile('src/second.ts');
    const filesByPath = new Map([
      [first.path, first],
      [second.path, second],
    ]);

    const center = resolveFocusCenterFile([first, second], filesByPath, null, 'src/missing.ts');

    expect(center).toBe(first);
  });
});

describe('graph viewport helpers', () => {
  it('clamps graph zoom to the supported range', () => {
    expect(clampGraphScale(0.2)).toBe(0.75);
    expect(clampGraphScale(3)).toBe(2.25);
    expect(clampGraphScale(1.1254)).toBe(1.125);
  });

  it('zooms around the provided point instead of drifting to origin', () => {
    const viewport = { x: 80, y: 40, scale: 1 };
    const point = { x: 400, y: 240 };

    const zoomed = zoomViewportAtPoint(viewport, 1.5, point);

    expect(zoomed).toEqual({
      x: -80,
      y: -60,
      scale: 1.5,
    });
  });

  it('fits nodes inside the padded canvas bounds', () => {
    const nodes = [
      { x: 120, y: 120, radius: 24 },
      { x: 860, y: 520, radius: 32 },
      { x: 480, y: 260, radius: 28 },
    ];

    const viewport = fitViewportToNodes(nodes, 72);
    const transformed = nodes.map(node => ({
      minX: viewport.x + ((node.x - node.radius) * viewport.scale),
      maxX: viewport.x + ((node.x + node.radius) * viewport.scale),
      minY: viewport.y + ((node.y - node.radius) * viewport.scale),
      maxY: viewport.y + ((node.y + node.radius) * viewport.scale),
    }));

    expect(viewport.scale).toBeGreaterThan(0.75);
    expect(viewport.scale).toBeLessThanOrEqual(2.25);
    expect(Math.min(...transformed.map(node => node.minX))).toBeGreaterThanOrEqual(71.5);
    expect(Math.max(...transformed.map(node => node.maxX))).toBeLessThanOrEqual(928.5);
    expect(Math.min(...transformed.map(node => node.minY))).toBeGreaterThanOrEqual(71.5);
    expect(Math.max(...transformed.map(node => node.maxY))).toBeLessThanOrEqual(608.5);
  });

  it('returns the default viewport for an empty graph', () => {
    expect(fitViewportToNodes([])).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe('applyNodePositionOverrides', () => {
  it('overrides only manually positioned focus nodes', () => {
    const nodes = [
      { id: 'a', path: 'src/a.ts', x: 10, y: 20 },
      { id: 'b', path: 'src/b.ts', x: 30, y: 40 },
    ];

    const updated = applyNodePositionOverrides(nodes, {
      'src/b.ts': { x: 300, y: 400 },
    });

    expect(updated[0]).toBe(nodes[0]);
    expect(updated[1]).toEqual({ id: 'b', path: 'src/b.ts', x: 300, y: 400 });
  });
});

describe('focus hover helpers', () => {
  it('builds a direct neighborhood for the hovered focus node', () => {
    const neighborhood = focusNeighborhoodFromEdges([
      { source: 'src/a.ts', target: 'src/b.ts' },
      { source: 'src/c.ts', target: 'src/a.ts' },
      { source: 'src/c.ts', target: 'src/d.ts' },
    ], 'src/a.ts');

    expect([...neighborhood].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('shows relation labels for hovered edges even when the global toggle is off', () => {
    expect(shouldShowFocusRelationLabel({
      relation: 'feeds',
      showEdgeLabels: false,
      activePath: 'src/a.ts',
      source: 'src/a.ts',
      target: 'src/b.ts',
      touchesCenter: false,
    })).toBe(true);

    expect(shouldShowFocusRelationLabel({
      relation: 'feeds',
      showEdgeLabels: false,
      activePath: 'src/a.ts',
      source: 'src/c.ts',
      target: 'src/b.ts',
      touchesCenter: true,
    })).toBe(false);

    expect(shouldShowFocusRelationLabel({
      relation: 'feeds',
      showEdgeLabels: true,
      activePath: null,
      source: 'src/c.ts',
      target: 'src/b.ts',
      touchesCenter: true,
    })).toBe(true);
  });
});

describe('mergeFocusEdges', () => {
  it('collapses duplicate visual connections while keeping unique relation labels', () => {
    const merged = mergeFocusEdges([
      { id: 'a->b:implements', source: 'src/a.ts', target: 'src/b.ts', relation: 'implements', closeness: 3 },
      { id: 'b->a:implements', source: 'src/b.ts', target: 'src/a.ts', relation: 'implements', closeness: 5 },
      { id: 'b->a:doc-for', source: 'src/b.ts', target: 'src/a.ts', relation: 'doc-for', closeness: 4 },
      { id: 'a->c:test-of', source: 'src/a.ts', target: 'src/c.ts', relation: 'test-of', closeness: 2 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'a->b:implements',
      relation: 'implements / doc-for',
      closeness: 5,
    });
    expect(merged[1]).toMatchObject({
      id: 'a->c:test-of',
      relation: 'test-of',
      closeness: 2,
    });
  });
});

describe('orderByWeightedConnections', () => {
  it('keeps strongly connected nodes adjacent in the radial order', () => {
    const ordered = orderByWeightedConnections(
      [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
        { id: 'd' },
      ],
      [
        { source: 'a', target: 'b', weight: 5 },
        { source: 'c', target: 'd', weight: 5 },
        { source: 'b', target: 'c', weight: 1 },
      ],
      item => (item.id === 'a' ? 10 : 0),
    ).map(item => item.id);

    expect(Math.abs(ordered.indexOf('a') - ordered.indexOf('b'))).toBe(1);
    expect(Math.abs(ordered.indexOf('c') - ordered.indexOf('d'))).toBe(1);
  });
});
