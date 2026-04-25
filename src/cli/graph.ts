import { normalizeRelation } from '../shared/types.js';
import type {
  Canopy, Closeness, RelationType, FileRelation,
} from '../shared/types.js';

// ---- Path normalization ----

/** Normalize file paths: forward slashes, no leading ./ */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// ---- Reverse index ----

export interface ReverseEntry {
  source: string;
  closeness: Closeness;
  relation?: RelationType;
}

export type ReverseIndex = Map<string, ReverseEntry[]>;

/** Build a reverse index: for each relatedFiles target, record who points at it. */
export function buildReverseIndex(canopy: Canopy): ReverseIndex {
  const index: ReverseIndex = new Map();

  for (const [filePath, fc] of Object.entries(canopy.files)) {
    for (const entry of fc.relatedFiles ?? []) {
      const rel = normalizeRelation(entry);
      const target = normalizePath(rel.path);
      const closeness = (rel.closeness ?? 3) as Closeness;

      if (!index.has(target)) index.set(target, []);
      index.get(target)!.push({
        source: normalizePath(filePath),
        closeness,
        relation: rel.relation,
      });
    }
  }

  return index;
}

// ---- Graph node ----

export interface GraphNode {
  path: string;
  relation?: RelationType;
  closeness?: Closeness;
  hop: number;
  children: GraphNode[];
}

export interface WalkOptions {
  minCloseness?: number;
  relation?: RelationType;
  reverseIndex?: ReverseIndex;
}

/** BFS graph walker — traverse the relation graph in either direction. */
export function walkGraph(
  canopy: Canopy,
  file: string,
  direction: 'in' | 'out',
  hops: number,
  opts: WalkOptions = {},
): GraphNode {
  const minCloseness = opts.minCloseness ?? 1;
  const relationFilter = opts.relation;
  const reverseIdx = direction === 'in'
    ? (opts.reverseIndex ?? buildReverseIndex(canopy))
    : undefined;

  const normalizedFile = normalizePath(file);
  const visited = new Set<string>([normalizedFile]);

  function getNeighbors(nodePath: string): Array<{ path: string; closeness: Closeness; relation?: RelationType }> {
    if (direction === 'out') {
      const fc = canopy.files[nodePath];
      if (!fc?.relatedFiles) return [];
      return (fc.relatedFiles).map(normalizeRelation).map(rel => ({
        path: normalizePath(rel.path),
        closeness: (rel.closeness ?? 3) as Closeness,
        relation: rel.relation,
      }));
    } else {
      return (reverseIdx!.get(nodePath) ?? []).map(e => ({
        path: normalizePath(e.source),
        closeness: e.closeness,
        relation: e.relation,
      }));
    }
  }

  function walk(nodePath: string, currentHop: number): GraphNode[] {
    if (currentHop > hops) return [];
    const neighbors = getNeighbors(nodePath);
    const children: GraphNode[] = [];

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.path)) continue;
      if (neighbor.closeness < minCloseness) continue;
      if (relationFilter && neighbor.relation !== relationFilter) continue;

      visited.add(neighbor.path);
      const childChildren = walk(neighbor.path, currentHop + 1);
      children.push({
        path: neighbor.path,
        relation: neighbor.relation,
        closeness: neighbor.closeness,
        hop: currentHop,
        children: childChildren,
      });
    }

    return children;
  }

  return {
    path: normalizedFile,
    hop: 0,
    children: walk(normalizedFile, 1),
  };
}

/** Render a graph tree as indented text with directional arrows. */
export function renderGraphTree(node: GraphNode, direction: 'in' | 'out'): string {
  const arrow = direction === 'in' ? '←' : '→';
  const lines: string[] = [node.path];

  function renderChildren(children: GraphNode[], indent: string): void {
    for (const child of children) {
      const relLabel = child.relation ? ` [${child.relation}]` : '';
      const closeLabel = ` (closeness ${child.closeness ?? 3})`;
      lines.push(`${indent}${arrow} ${child.path}${relLabel}${closeLabel}`);
      renderChildren(child.children, indent + '  ');
    }
  }

  renderChildren(node.children, '  ');
  return lines.join('\n');
}
