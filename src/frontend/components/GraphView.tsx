import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, MergedFileRecord, Priority } from '../../shared/types';
import { checkAuthorityHealth } from '../../shared/types';
import { heatColor, PRIORITY_COLORS } from '../lib/tokens';
import { useWorkspace } from '../stores/workspace';

type GraphMode = 'overview' | 'focus';
type DirectionMode = 'both' | 'in' | 'out';
type ColorMode = 'feature' | 'authority' | 'heat';

interface GroupNode {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  fileCount: number;
  openTodoCount: number;
  attentionCount: number;
  anchorPath: string;
}

interface GroupEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

interface FocusNode {
  id: string;
  path: string;
  label: string;
  hop: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  file: MergedFileRecord;
}

interface FocusEdge {
  id: string;
  source: string;
  target: string;
  relation?: string;
  closeness?: number;
}

interface NeighborEdge {
  path: string;
  relation?: string;
  closeness?: number;
}

interface WeightedEdge {
  source: string;
  target: string;
  weight: number;
}

interface FocusParent {
  path: string;
  closeness: number;
}

interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}

interface PositionedNode {
  x: number;
  y: number;
  radius: number;
}

interface ManualNodePosition {
  x: number;
  y: number;
}

const CANVAS = { width: 1000, height: 680 };
const INITIAL_GRAPH_VIEWPORT: GraphViewport = { x: 0, y: 0, scale: 1 };
const MIN_GRAPH_SCALE = 0.75;
const MAX_GRAPH_SCALE = 2.25;
const ZOOM_STEP = 0.18;
const FEATURE_PALETTE = [
  'var(--color-accent)',
  'var(--color-closeness-3)',
  'var(--color-closeness-4)',
  'var(--color-closeness-5)',
  'var(--color-p3)',
  'var(--color-p2)',
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function firstSegment(path: string): string {
  return path.split('/')[0] || path;
}

function featureKey(file: MergedFileRecord): string {
  if (file.featureId) return `feature:${file.featureId}`;
  const segment = firstSegment(file.path);
  return segment ? `dir:${segment}` : 'dir:unassigned';
}

function featureLabel(groupKey: string, features: Record<string, Feature>): string {
  if (groupKey.startsWith('feature:')) {
    const featureId = groupKey.slice('feature:'.length);
    return features[featureId]?.name ?? featureId;
  }
  if (groupKey.startsWith('dir:')) {
    return groupKey.slice('dir:'.length);
  }
  return groupKey;
}

function featureColor(groupKey: string): string {
  return FEATURE_PALETTE[hashString(groupKey) % FEATURE_PALETTE.length];
}

function authorityColor(level?: string): string {
  switch (level) {
    case 'standard':
      return 'var(--color-closeness-5)';
    case 'specification':
      return 'var(--color-closeness-4)';
    case 'guideline':
      return 'var(--color-closeness-3)';
    case 'blueprint':
      return 'var(--color-closeness-2)';
    case 'idea':
      return 'var(--color-closeness-1)';
    default:
      return 'var(--color-surface-hover)';
  }
}

function engagementScore(analytics: ReturnType<typeof useWorkspace.getState>['analytics'], filePath: string): number {
  if (!analytics) return 0;
  const fileAnalytics = analytics.files[filePath];
  if (!fileAnalytics) return 0;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  let reads = 0;
  let edits = 0;
  let writes = 0;
  let queries = 0;
  for (const [date, bucket] of Object.entries(fileAnalytics.days)) {
    if (date >= cutoff) {
      reads += bucket.readCount ?? 0;
      edits += bucket.editCount ?? 0;
      writes += bucket.writeCount ?? 0;
      queries += bucket.canopyQueryCount ?? 0;
    }
  }
  return reads + (edits * 2) + (writes * 2) + queries;
}

function fileAttention(file: MergedFileRecord): number {
  let score = 0;
  const health = file.authorityHealth ?? checkAuthorityHealth(file);
  if (file.scoresReviewed !== true && (
    file.validity != null ||
    file.clarity != null ||
    file.completeness != null ||
    file.stability != null
  )) score += 1;
  if (health?.status === 'underscored') score += 2;
  if (health?.status === 'promotion-candidate') score += 1;
  if ((file.stability ?? 5) <= 2) score += 1;
  if (file.openTodoCount > 0) score += 1;
  return score;
}

function pickAnchor(files: MergedFileRecord[]): MergedFileRecord {
  return [...files].sort((left, right) => {
    const attentionDelta = fileAttention(right) - fileAttention(left);
    if (attentionDelta !== 0) return attentionDelta;
    const todoDelta = right.openTodoCount - left.openTodoCount;
    if (todoDelta !== 0) return todoDelta;
    return left.path.localeCompare(right.path);
  })[0];
}

function colorForFile(file: MergedFileRecord, colorMode: ColorMode, analytics: ReturnType<typeof useWorkspace.getState>['analytics']): string {
  if (colorMode === 'authority') return authorityColor(file.authorityLevel);
  if (colorMode === 'heat') return heatColor(engagementScore(analytics, file.path)) ?? 'var(--color-surface-hover)';
  return featureColor(featureKey(file));
}

function compareFileImportance(left: MergedFileRecord, right: MergedFileRecord): number {
  const attentionDelta = fileAttention(right) - fileAttention(left);
  if (attentionDelta !== 0) return attentionDelta;
  const todoDelta = right.openTodoCount - left.openTodoCount;
  if (todoDelta !== 0) return todoDelta;
  return left.path.localeCompare(right.path);
}

function fileLayoutWeight(file: MergedFileRecord): number {
  return (fileAttention(file) * 4) + (file.openTodoCount * 2);
}

export function resolveFocusCenterFile(
  index: MergedFileRecord[],
  filesByPath: Map<string, MergedFileRecord>,
  selectedFile: MergedFileRecord | null,
  focusPath: string | null,
): MergedFileRecord | null {
  if (focusPath) {
    if (selectedFile?.path === focusPath) return selectedFile;
    const focused = filesByPath.get(focusPath);
    if (focused) return focused;
  }
  return selectedFile ?? index[0] ?? null;
}

export function clampGraphScale(scale: number): number {
  const clamped = Math.max(MIN_GRAPH_SCALE, Math.min(MAX_GRAPH_SCALE, scale));
  return Number(clamped.toFixed(3));
}

export function zoomViewportAtPoint(
  viewport: GraphViewport,
  nextScale: number,
  point: { x: number; y: number },
): GraphViewport {
  const scale = clampGraphScale(nextScale);
  if (scale === viewport.scale) return viewport;
  const graphX = (point.x - viewport.x) / viewport.scale;
  const graphY = (point.y - viewport.y) / viewport.scale;
  return {
    x: Number((point.x - (graphX * scale)).toFixed(3)),
    y: Number((point.y - (graphY * scale)).toFixed(3)),
    scale,
  };
}

export function applyNodePositionOverrides<T extends { path: string; x: number; y: number }>(
  nodes: T[],
  positions: Record<string, ManualNodePosition>,
): T[] {
  return nodes.map((node) => {
    const position = positions[node.path];
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}

export function focusNeighborhoodFromEdges(
  edges: Array<{ source: string; target: string }>,
  activePath: string | null,
): Set<string> {
  const connected = new Set<string>();
  if (!activePath) return connected;
  connected.add(activePath);
  for (const edge of edges) {
    if (edge.source === activePath) {
      connected.add(edge.target);
    } else if (edge.target === activePath) {
      connected.add(edge.source);
    }
  }
  return connected;
}

export function mergeFocusEdges<T extends { id: string; source: string; target: string; relation?: string; closeness?: number }>(
  edges: T[],
): T[] {
  const merged = new Map<string, { edge: T; relations: Set<string>; maxCloseness: number; order: number }>();

  edges.forEach((edge, order) => {
    const [left, right] = edge.source.localeCompare(edge.target) <= 0
      ? [edge.source, edge.target]
      : [edge.target, edge.source];
    const key = `${left}<->${right}`;
    const relation = edge.relation?.trim();
    const closeness = edge.closeness ?? 3;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        edge,
        relations: new Set(relation ? [relation] : []),
        maxCloseness: closeness,
        order,
      });
      return;
    }

    if (relation) existing.relations.add(relation);
    if (closeness > existing.maxCloseness) {
      existing.edge = { ...edge, id: existing.edge.id } as T;
      existing.maxCloseness = closeness;
    }
  });

  return [...merged.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ edge, relations, maxCloseness }) => ({
      ...edge,
      relation: relations.size > 0 ? [...relations].join(' / ') : undefined,
      closeness: maxCloseness,
    }) as T);
}

export function shouldShowFocusRelationLabel({
  relation,
  showEdgeLabels,
  activePath,
  source,
  target,
  touchesCenter,
}: {
  relation?: string;
  showEdgeLabels: boolean;
  activePath: string | null;
  source: string;
  target: string;
  touchesCenter: boolean;
}): boolean {
  if (!relation) return false;
  if (activePath && (source === activePath || target === activePath)) return true;
  return showEdgeLabels && touchesCenter;
}

export function fitViewportToNodes(
  nodes: PositionedNode[],
  padding: number = 72,
): GraphViewport {
  if (nodes.length === 0) return { ...INITIAL_GRAPH_VIEWPORT };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }

  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, CANVAS.width - (padding * 2));
  const availableHeight = Math.max(1, CANVAS.height - (padding * 2));
  const scale = clampGraphScale(Math.min(
    availableWidth / graphWidth,
    availableHeight / graphHeight,
    MAX_GRAPH_SCALE,
  ));

  return {
    x: Number((padding + ((availableWidth - (graphWidth * scale)) / 2) - (minX * scale)).toFixed(3)),
    y: Number((padding + ((availableHeight - (graphHeight * scale)) / 2) - (minY * scale)).toFixed(3)),
    scale,
  };
}

export function orderByWeightedConnections<T extends { id: string }>(
  items: T[],
  edges: WeightedEdge[],
  itemWeight: (item: T) => number = () => 0,
): T[] {
  if (items.length <= 2) {
    return [...items].sort((left, right) => {
      const weightDelta = itemWeight(right) - itemWeight(left);
      return weightDelta !== 0 ? weightDelta : left.id.localeCompare(right.id);
    });
  }

  const byId = new Map(items.map(item => [item.id, item]));
  const adjacency = new Map<string, Map<string, number>>();
  const connectedWeight = new Map<string, number>();

  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const sourceEdges = adjacency.get(edge.source) ?? new Map<string, number>();
    sourceEdges.set(edge.target, (sourceEdges.get(edge.target) ?? 0) + edge.weight);
    adjacency.set(edge.source, sourceEdges);

    const targetEdges = adjacency.get(edge.target) ?? new Map<string, number>();
    targetEdges.set(edge.source, (targetEdges.get(edge.source) ?? 0) + edge.weight);
    adjacency.set(edge.target, targetEdges);

    connectedWeight.set(edge.source, (connectedWeight.get(edge.source) ?? 0) + edge.weight);
    connectedWeight.set(edge.target, (connectedWeight.get(edge.target) ?? 0) + edge.weight);
  }

  const rank = (item: T) => itemWeight(item) + (connectedWeight.get(item.id) ?? 0);
  const compare = (left: T, right: T) => {
    const rankDelta = rank(right) - rank(left);
    return rankDelta !== 0 ? rankDelta : left.id.localeCompare(right.id);
  };

  const sorted = [...items].sort(compare);
  const ordered: T[] = [sorted[0]];
  const remaining = new Set(sorted.slice(1).map(item => item.id));

  while (remaining.size > 0) {
    const head = ordered[0];
    const tail = ordered[ordered.length - 1];
    let bestId: string | null = null;
    let bestSide: 'head' | 'tail' = 'tail';
    let bestConnection = -1;
    let bestRank = -Infinity;

    for (const id of remaining) {
      const item = byId.get(id);
      if (!item) continue;
      const headConnection = adjacency.get(id)?.get(head.id) ?? 0;
      const tailConnection = adjacency.get(id)?.get(tail.id) ?? 0;
      const side: 'head' | 'tail' = headConnection > tailConnection ? 'head' : 'tail';
      const connection = Math.max(headConnection, tailConnection);
      const candidateRank = rank(item);
      const isBetter =
        connection > bestConnection ||
        (connection === bestConnection && candidateRank > bestRank) ||
        (connection === bestConnection && candidateRank === bestRank && (bestId == null || id.localeCompare(bestId) < 0));

      if (isBetter) {
        bestId = id;
        bestSide = side;
        bestConnection = connection;
        bestRank = candidateRank;
      }
    }

    if (!bestId) break;
    const item = byId.get(bestId);
    if (!item) break;
    if (bestSide === 'head') {
      ordered.unshift(item);
    } else {
      ordered.push(item);
    }
    remaining.delete(bestId);
  }

  return ordered;
}

function layoutCircle<T extends { id: string }>(
  items: T[],
  radiusX: number,
  radiusY: number,
  centerX: number,
  centerY: number,
): Array<T & { x: number; y: number; angle: number }> {
  if (items.length === 0) return [];
  return items.map((item, index) => {
    const angle = ((Math.PI * 2) / items.length) * index - (Math.PI / 2);
    return {
      ...item,
      angle,
      x: centerX + (Math.cos(angle) * radiusX),
      y: centerY + (Math.sin(angle) * radiusY),
    };
  });
}

function LegendSwatch({
  color,
  label,
  title,
}: {
  color: string;
  label: string;
  title?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span
        className="h-2.5 w-2.5 rounded-full border border-border"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </span>
  );
}

function GraphLegend({ colorMode }: { colorMode: ColorMode }) {
  return (
    <div className="rounded border border-border bg-surface p-3 text-xs text-text-muted">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">Legend</div>
      {colorMode === 'feature' ? (
        <div className="space-y-2">
          <p>Node colors separate feature or top-level directory groups. These are categories, not priority.</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {FEATURE_PALETTE.slice(0, 4).map((color, index) => (
              <LegendSwatch key={color} color={color} label={`Group ${index + 1}`} />
            ))}
          </div>
        </div>
      ) : colorMode === 'authority' ? (
        <div className="space-y-2">
          <p>Node colors show authority hierarchy. Higher authority should win conflicts and be changed more carefully.</p>
          <div className="grid grid-cols-2 gap-1">
            <LegendSwatch color="var(--color-closeness-1)" label="1 Idea" />
            <LegendSwatch color="var(--color-closeness-2)" label="2 Blueprint" />
            <LegendSwatch color="var(--color-closeness-3)" label="3 Guide" />
            <LegendSwatch color="var(--color-closeness-4)" label="4 Spec" />
            <LegendSwatch color="var(--color-closeness-5)" label="5 Standard" />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p>Node colors show recent engagement heat from reads, edits, writes, Canopy queries, and search-result hits.</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <LegendSwatch color="var(--color-heat-low)" label="Low" />
            <LegendSwatch color="var(--color-heat-med)" label="Med" />
            <LegendSwatch color="var(--color-heat-high)" label="High" />
            <LegendSwatch color="var(--color-heat-max)" label="Max" />
          </div>
        </div>
      )}
      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-text-secondary">Edges</div>
        <p>Edge color and thickness show closeness. Warmer, thicker edges mean tighter relationships.</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <LegendSwatch color="var(--color-closeness-1)" label="1 loose" />
          <LegendSwatch color="var(--color-closeness-3)" label="3 related" />
          <LegendSwatch color="var(--color-closeness-5)" label="5 tight" />
        </div>
      </div>
    </div>
  );
}

export function GraphView() {
  const {
    analytics,
    features,
    index,
    selectedFile,
    selectFile,
    setViewMode,
  } = useWorkspace();

  const [graphMode, setGraphMode] = useState<GraphMode>('overview');
  const [direction, setDirection] = useState<DirectionMode>('both');
  const [colorMode, setColorMode] = useState<ColorMode>('feature');
  const [minCloseness, setMinCloseness] = useState(2);
  const [hops, setHops] = useState(2);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [focusPath, setFocusPath] = useState<string | null>(selectedFile?.path ?? null);
  const [focusNodePositions, setFocusNodePositions] = useState<Record<string, ManualNodePosition>>({});
  const [draggingNodePath, setDraggingNodePath] = useState<string | null>(null);
  const [hoveredFocusPath, setHoveredFocusPath] = useState<string | null>(null);
  const [viewport, setViewport] = useState<GraphViewport>(() => INITIAL_GRAPH_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const nodeDragState = useRef<{
    pointerId: number;
    path: string;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextNodeClick = useRef<string | null>(null);

  const filesByPath = useMemo(() => {
    const map = new Map<string, MergedFileRecord>();
    for (const file of index) map.set(file.path, file);
    return map;
  }, [index]);

  const reverseEdges = useMemo(() => {
    const map = new Map<string, NeighborEdge[]>();
    for (const file of index) {
      for (const relation of file.relatedFiles ?? []) {
        if (!filesByPath.has(relation.path)) continue;
        const bucket = map.get(relation.path) ?? [];
        bucket.push({ path: file.path, relation: relation.relation, closeness: relation.closeness });
        map.set(relation.path, bucket);
      }
    }
    return map;
  }, [filesByPath, index]);

  useEffect(() => {
    setFocusPath(selectedFile?.path ?? null);
  }, [selectedFile?.path]);

  const toCanvasPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS.width,
      y: ((clientY - rect.top) / rect.height) * CANVAS.height,
    };
  };

  const resetViewport = () => setViewport({ ...INITIAL_GRAPH_VIEWPORT });

  const handleZoom = (direction: 'in' | 'out') => {
    const factor = direction === 'in' ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
    const center = { x: CANVAS.width / 2, y: CANVAS.height / 2 };
    setViewport(current => zoomViewportAtPoint(current, current.scale * factor, center));
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    dragState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    setIsPanning(true);
    svg.setPointerCapture(event.pointerId);
  };

  const handleNodePointerDown = (event: React.PointerEvent<SVGGElement>, node: FocusNode) => {
    if (graphMode !== 'focus' || event.button !== 0) return;
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    nodeDragState.current = {
      pointerId: event.pointerId,
      path: node.path,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: node.x,
      originY: node.y,
      moved: false,
    };
    setDraggingNodePath(node.path);
    svg.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const nodeDrag = nodeDragState.current;
    if (nodeDrag && nodeDrag.pointerId === event.pointerId) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const deltaX = ((event.clientX - nodeDrag.startClientX) / rect.width) * CANVAS.width / viewport.scale;
      const deltaY = ((event.clientY - nodeDrag.startClientY) / rect.height) * CANVAS.height / viewport.scale;
      if (Math.abs(event.clientX - nodeDrag.startClientX) + Math.abs(event.clientY - nodeDrag.startClientY) > 3) {
        nodeDrag.moved = true;
      }
      setFocusNodePositions(current => ({
        ...current,
        [nodeDrag.path]: {
          x: Number((nodeDrag.originX + deltaX).toFixed(3)),
          y: Number((nodeDrag.originY + deltaY).toFixed(3)),
        },
      }));
      return;
    }

    const drag = dragState.current;
    const svg = svgRef.current;
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const deltaX = ((event.clientX - drag.startClientX) / rect.width) * CANVAS.width;
    const deltaY = ((event.clientY - drag.startClientY) / rect.height) * CANVAS.height;
    setViewport(current => ({
      ...current,
      x: Number((drag.originX + deltaX).toFixed(3)),
      y: Number((drag.originY + deltaY).toFixed(3)),
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const nodeDrag = nodeDragState.current;
    const svg = svgRef.current;
    if (nodeDrag && svg && nodeDrag.pointerId === event.pointerId) {
      if (svg.hasPointerCapture(event.pointerId)) {
        svg.releasePointerCapture(event.pointerId);
      }
      if (nodeDrag.moved) {
        suppressNextNodeClick.current = nodeDrag.path;
      }
      nodeDragState.current = null;
      setDraggingNodePath(null);
      return;
    }

    const drag = dragState.current;
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
    setIsPanning(false);
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const factor = event.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
    setViewport(current => zoomViewportAtPoint(current, current.scale * factor, point));
  };

  const overview = useMemo(() => {
    const groupMembers = new Map<string, MergedFileRecord[]>();
    for (const file of index) {
      const key = featureKey(file);
      const bucket = groupMembers.get(key) ?? [];
      bucket.push(file);
      groupMembers.set(key, bucket);
    }

    const rawGroups = [...groupMembers.entries()]
      .map(([key, files]) => {
        const attentionCount = files.reduce((sum, file) => sum + (fileAttention(file) > 0 ? 1 : 0), 0);
        const openTodoCount = files.reduce((sum, file) => sum + file.openTodoCount, 0);
        const anchor = pickAnchor(files);
        return {
          id: key,
          label: featureLabel(key, features),
          files,
          fileCount: files.length,
          openTodoCount,
          attentionCount,
          anchorPath: anchor.path,
        };
      })
      .sort((left, right) => right.fileCount - left.fileCount || left.label.localeCompare(right.label));

    const groupByPath = new Map<string, string>();
    for (const group of rawGroups) {
      for (const file of group.files) groupByPath.set(file.path, group.id);
    }

    const edgeMap = new Map<string, GroupEdge>();
    for (const file of index) {
      const sourceGroup = groupByPath.get(file.path);
      if (!sourceGroup) continue;
      for (const relation of file.relatedFiles ?? []) {
        const targetGroup = groupByPath.get(relation.path);
        if (!targetGroup || targetGroup === sourceGroup) continue;
        const pair = [sourceGroup, targetGroup].sort();
        const edgeId = `${pair[0]}::${pair[1]}`;
        const existing = edgeMap.get(edgeId);
        if (existing) {
          existing.weight += 1;
        } else {
          edgeMap.set(edgeId, { id: edgeId, source: pair[0], target: pair[1], weight: 1 });
        }
      }
    }

    const orderedGroups = orderByWeightedConnections(
      rawGroups,
      [...edgeMap.values()],
      group => group.fileCount + (group.attentionCount * 3) + (group.openTodoCount * 2),
    );

    const placed = layoutCircle(
      orderedGroups.map(group => ({
        ...group,
        radius: Math.max(24, Math.min(56, 18 + Math.sqrt(group.fileCount) * 7)),
        color: featureColor(group.id),
      })),
      Math.max(170, 260 + (rawGroups.length * 10)),
      Math.max(130, 180 + (rawGroups.length * 8)),
      CANVAS.width / 2,
      CANVAS.height / 2
    ) as GroupNode[];

    return {
      nodes: placed,
      edges: [...edgeMap.values()],
    };
  }, [features, index]);

  const baseFocusGraph = useMemo(() => {
    const centerFile = resolveFocusCenterFile(index, filesByPath, selectedFile, focusPath);
    if (!centerFile) {
      return { centerFile: null, nodes: [] as FocusNode[], edges: [] as FocusEdge[] };
    }

    const hopMap = new Map<string, number>([[centerFile.path, 0]]);
    const parentMap = new Map<string, FocusParent>();
    let frontier = [centerFile.path];

    for (let hop = 1; hop <= hops; hop += 1) {
      const next: string[] = [];
      for (const path of frontier) {
        const outgoing = direction === 'in'
          ? []
          : (filesByPath.get(path)?.relatedFiles ?? [])
              .filter(relation => filesByPath.has(relation.path) && (relation.closeness ?? 3) >= minCloseness)
              .map(relation => ({ path: relation.path, closeness: relation.closeness ?? 3 }));
        const incoming = direction === 'out'
          ? []
          : (reverseEdges.get(path) ?? [])
              .filter(relation => (relation.closeness ?? 3) >= minCloseness)
              .map(relation => ({ path: relation.path, closeness: relation.closeness ?? 3 }));

        for (const neighbor of [...outgoing, ...incoming]) {
          if (!hopMap.has(neighbor.path)) {
            hopMap.set(neighbor.path, hop);
            parentMap.set(neighbor.path, { path, closeness: neighbor.closeness });
            next.push(neighbor.path);
            continue;
          }

          const existingHop = hopMap.get(neighbor.path);
          const existingParent = parentMap.get(neighbor.path);
          if (existingHop === hop && (!existingParent || neighbor.closeness > existingParent.closeness)) {
            parentMap.set(neighbor.path, { path, closeness: neighbor.closeness });
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    const focusFiles = [...hopMap.entries()]
      .map(([path, hop]) => ({ file: filesByPath.get(path), hop }))
      .filter((entry): entry is { file: MergedFileRecord; hop: number } => Boolean(entry.file))
      .sort((left, right) => left.hop - right.hop || left.file.path.localeCompare(right.file.path));

    const nodesByHop = new Map<number, Array<{ file: MergedFileRecord; parent?: FocusParent }>>();
    for (const entry of focusFiles) {
      const bucket = nodesByHop.get(entry.hop) ?? [];
      bucket.push({ file: entry.file, parent: parentMap.get(entry.file.path) });
      nodesByHop.set(entry.hop, bucket);
    }

    const nodeMap = new Map<string, FocusNode>();
    const angleByPath = new Map<string, number>([[centerFile.path, -Math.PI / 2]]);
    nodeMap.set(centerFile.path, {
      id: centerFile.path,
      path: centerFile.path,
      label: basename(centerFile.path),
      hop: 0,
      x: CANVAS.width / 2,
      y: CANVAS.height / 2,
      radius: 28,
      color: colorForFile(centerFile, colorMode, analytics),
      file: centerFile,
    });

    for (let hop = 1; hop <= hops; hop += 1) {
      const entries = nodesByHop.get(hop) ?? [];
      const files = [...entries].sort((left, right) => {
        if (hop > 1) {
          const leftParentAngle = angleByPath.get(left.parent?.path ?? '') ?? 0;
          const rightParentAngle = angleByPath.get(right.parent?.path ?? '') ?? 0;
          const angleDelta = leftParentAngle - rightParentAngle;
          if (Math.abs(angleDelta) > 0.0001) return angleDelta;
        }
        const closenessDelta = (right.parent?.closeness ?? 0) - (left.parent?.closeness ?? 0);
        if (closenessDelta !== 0) return closenessDelta;
        const layoutDelta = fileLayoutWeight(right.file) - fileLayoutWeight(left.file);
        if (layoutDelta !== 0) return layoutDelta;
        return compareFileImportance(left.file, right.file);
      });
      const placed = layoutCircle(
        files.map(entry => ({
          id: entry.file.path,
          path: entry.file.path,
          label: basename(entry.file.path),
          hop,
          radius: Math.max(14, 20 - (hop * 2)),
          color: colorForFile(entry.file, colorMode, analytics),
          file: entry.file,
        })),
        150 + ((hop - 1) * 135),
        120 + ((hop - 1) * 110),
        CANVAS.width / 2,
        CANVAS.height / 2
      );

      for (const node of placed) {
        nodeMap.set(node.path, node as FocusNode);
        angleByPath.set(node.path, node.angle);
      }
    }

    const includedPaths = new Set(nodeMap.keys());
    const edges: FocusEdge[] = [];
    for (const file of focusFiles.map(entry => entry.file)) {
      for (const relation of file.relatedFiles ?? []) {
        if (!includedPaths.has(relation.path)) continue;
        if ((relation.closeness ?? 3) < minCloseness) continue;
        edges.push({
          id: `${file.path}->${relation.path}:${relation.relation ?? 'related'}`,
          source: file.path,
          target: relation.path,
          relation: relation.relation,
          closeness: relation.closeness,
        });
      }
    }

    return {
      centerFile,
      nodes: [...nodeMap.values()],
      edges: mergeFocusEdges(edges),
    };
  }, [analytics, colorMode, direction, filesByPath, focusPath, hops, index, minCloseness, reverseEdges, selectedFile]);

  const focusGraph = useMemo(() => ({
    ...baseFocusGraph,
    nodes: applyNodePositionOverrides(baseFocusGraph.nodes, focusNodePositions),
  }), [baseFocusGraph, focusNodePositions]);

  const focusHoverNeighborhood = useMemo(
    () => focusNeighborhoodFromEdges(focusGraph.edges, hoveredFocusPath),
    [focusGraph.edges, hoveredFocusPath],
  );

  useEffect(() => {
    setFocusNodePositions({});
    nodeDragState.current = null;
    suppressNextNodeClick.current = null;
    setDraggingNodePath(null);
    setHoveredFocusPath(null);
  }, [direction, focusPath, hops, index.length, minCloseness]);

  const overviewNodeMap = useMemo(
    () => new Map(overview.nodes.map(node => [node.id, node])),
    [overview.nodes],
  );
  const focusNodeMap = useMemo(
    () => new Map(focusGraph.nodes.map(node => [node.id, node])),
    [focusGraph.nodes],
  );
  const overviewLabelIds = useMemo(() => {
    const ranked = [...overview.nodes]
      .sort((left, right) =>
        right.fileCount - left.fileCount ||
        right.attentionCount - left.attentionCount ||
        left.label.localeCompare(right.label));
    const limit = overview.nodes.length <= 10
      ? overview.nodes.length
      : Math.min(10, Math.max(6, Math.ceil(overview.nodes.length * 0.65)));
    return new Set(ranked.slice(0, limit).map(node => node.id));
  }, [overview.nodes]);
  const focusLabelIds = useMemo(() => {
    const ranked = [...focusGraph.nodes]
      .sort((left, right) =>
        left.hop - right.hop ||
        fileAttention(right.file) - fileAttention(left.file) ||
        left.label.localeCompare(right.label));
    const limit = focusGraph.nodes.length <= 12
      ? focusGraph.nodes.length
      : Math.min(12, Math.max(6, Math.ceil(focusGraph.nodes.length * 0.55)));
    const keep = new Set<string>();
    for (const node of ranked) {
      if (node.hop <= 1 || fileAttention(node.file) > 0) {
        keep.add(node.id);
      }
      if (keep.size >= limit) break;
    }
    if (keep.size < limit) {
      for (const node of ranked) {
        keep.add(node.id);
        if (keep.size >= limit) break;
      }
    }
    return keep;
  }, [focusGraph.nodes]);

  const fitVisibleGraph = () => {
    const nodes = graphMode === 'overview' ? overview.nodes : focusGraph.nodes;
    setViewport(fitViewportToNodes(nodes));
  };

  const hasManualFocusLayout = Object.keys(focusNodePositions).length > 0;
  const resetFocusLayout = () => {
    setFocusNodePositions({});
    setViewport(fitViewportToNodes(baseFocusGraph.nodes));
  };

  useEffect(() => {
    const nodes = graphMode === 'overview' ? overview.nodes : baseFocusGraph.nodes;
    setViewport(fitViewportToNodes(nodes));
  }, [
    graphMode,
    focusPath,
    selectedFile?.path,
    direction,
    hops,
    minCloseness,
    overview.nodes.length,
    overview.edges.length,
    baseFocusGraph.centerFile?.path,
    baseFocusGraph.nodes.length,
  ]);

  const currentFocusFile = focusGraph.centerFile;
  const topPriority = currentFocusFile?.highestPriority;
  const currentSummary = currentFocusFile?.summary;
  const currentHealth = currentFocusFile ? (currentFocusFile.authorityHealth ?? checkAuthorityHealth(currentFocusFile)) : null;
  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-surface p-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Graph Explorer</h2>
          <p className="mt-2 text-sm text-text-muted">
            Overview groups the repo into relation-weighted clusters. Focus recenters on the selected file and its local relation graph.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
            {(['overview', 'focus'] as GraphMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => {
                  setGraphMode(mode);
                  resetViewport();
                }}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  graphMode === mode
                    ? 'border-accent bg-accent text-on-accent'
                  : 'border-border bg-canvas text-text-muted hover:border-accent hover:text-text-primary'
              }`}
            >
              {mode === 'overview' ? 'Overview' : 'Focus'}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">Color</div>
          <div className="flex flex-wrap gap-2">
            {(['feature', 'authority', 'heat'] as ColorMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  colorMode === mode
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-border bg-canvas text-text-muted hover:border-accent hover:text-text-primary'
                }`}
              >
                {mode === 'heat' ? 'Analytics Heat' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {graphMode === 'focus' && (
          <div className="mb-4 rounded border border-border bg-canvas p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">Focus Controls</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {(['both', 'in', 'out'] as DirectionMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setDirection(mode)}
                  className={`rounded border px-2 py-1 text-xs transition-colors ${
                    direction === mode
                      ? 'border-accent bg-accent text-on-accent'
                      : 'border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary'
                  }`}
                >
                  {mode === 'both' ? 'Both' : mode === 'in' ? 'Fan In' : 'Fan Out'}
                </button>
              ))}
            </div>

            <label className="mb-3 block text-xs text-text-muted">
              Min closeness: <span className="text-text-primary">{minCloseness}</span>
              <input
                type="range"
                min={1}
                max={5}
                value={minCloseness}
                onChange={event => setMinCloseness(Number(event.target.value))}
                className="mt-2 w-full accent-[var(--color-accent)]"
              />
            </label>

            <label className="block text-xs text-text-muted">
              Hops: <span className="text-text-primary">{hops}</span>
              <input
                type="range"
                min={1}
                max={2}
                value={hops}
                onChange={event => setHops(Number(event.target.value))}
                className="mt-2 w-full accent-[var(--color-accent)]"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowEdgeLabels(current => !current)}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  showEdgeLabels
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary'
                }`}
              >
                Edge Labels {showEdgeLabels ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={resetFocusLayout}
                disabled={!hasManualFocusLayout}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  hasManualFocusLayout
                    ? 'border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary'
                    : 'border-border bg-surface text-text-muted opacity-50'
                }`}
              >
                Reset Layout
              </button>
            </div>
          </div>
        )}

        <GraphLegend colorMode={colorMode} />

        <div className="mt-4 rounded border border-border bg-canvas p-3">
          {graphMode === 'overview' ? (
            <>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">Overview Stats</div>
              <div className="space-y-1 text-sm text-text-muted">
                <p>{overview.nodes.length} groups</p>
                <p>{index.length} annotated files</p>
                <p>{overview.edges.length} cross-group links</p>
              </div>
              <p className="mt-3 text-xs text-text-muted">
                Click a cluster to recenter the graph on its anchor file.
              </p>
            </>
          ) : focusGraph.centerFile ? (
            <>
              <div className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">Current Focus</div>
              <div className="mb-2 font-mono text-xs text-text-secondary">{focusGraph.centerFile.path}</div>
              {focusGraph.centerFile.authorityLevel && (
                <p className="text-xs text-text-muted">Authority: {focusGraph.centerFile.authorityLevel}</p>
              )}
              {focusGraph.centerFile.status && (
                <p className="text-xs text-text-muted">Status: {focusGraph.centerFile.status}</p>
              )}
              {currentHealth && (
                <p className="text-xs text-text-muted">Health: {currentHealth.status}</p>
              )}
              {topPriority && (
                <p className="mt-1 text-xs" style={{ color: PRIORITY_COLORS[topPriority] }}>
                  Highest TODO priority: P{topPriority}
                </p>
              )}
              {currentSummary && (
                <p className="mt-3 text-sm text-text-muted">{currentSummary}</p>
              )}
              <button
                onClick={() => setViewMode('explorer')}
                className="mt-3 rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
              >
                Open In Explorer
              </button>
            </>
          ) : (
            <p className="text-sm text-text-muted">Select a file to seed the focus graph.</p>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-canvas p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-text-muted">
            Drag the canvas to pan. In Focus mode, hover nodes to spotlight direct relations or drag them to untangle dense neighborhoods.
          </p>
          <div className="flex items-center gap-2">
            <span className="rounded border border-border bg-surface px-2 py-1 text-[11px] font-mono text-text-secondary">
              {Math.round(viewport.scale * 100)}%
            </span>
            <button
              onClick={() => handleZoom('out')}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
              aria-label="Zoom out"
              title="Zoom out"
            >
              -
            </button>
            <button
              onClick={() => handleZoom('in')}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={fitVisibleGraph}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
            >
              Fit Graph
            </button>
            <button
              onClick={resetViewport}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
            >
              Reset View
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_55%)] p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
            className={`h-[680px] w-full select-none rounded-lg bg-surface ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ userSelect: 'none' }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            <rect
              x="0"
              y="0"
              width={CANVAS.width}
              height={CANVAS.height}
              fill="transparent"
              onPointerDown={handleCanvasPointerDown}
            />

            <g transform={`translate(${viewport.x} ${viewport.y})`}>
              <g transform={`scale(${viewport.scale})`}>
                {graphMode === 'focus' && focusGraph.centerFile && (
                  <circle
                    cx={CANVAS.width / 2}
                    cy={CANVAS.height / 2}
                    r="82"
                    fill="var(--color-accent)"
                    opacity={0.045}
                  />
                )}

                {graphMode === 'overview' ? (
                  <>
                    {overview.edges.map(edge => {
                      const source = overviewNodeMap.get(edge.source);
                      const target = overviewNodeMap.get(edge.target);
                      if (!source || !target) return null;
                      return (
                        <line
                          key={edge.id}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          stroke="var(--color-border)"
                          strokeWidth={1 + Math.min(5, edge.weight)}
                          opacity={0.45}
                        />
                      );
                    })}

                    {overview.nodes.map(node => {
                      const showLabel = overviewLabelIds.has(node.id);
                      return (
                        <g
                          key={node.id}
                          transform={`translate(${node.x} ${node.y})`}
                          className="cursor-pointer"
                          onClick={() => {
                            setFocusPath(node.anchorPath);
                            setGraphMode('focus');
                            resetViewport();
                            void selectFile(node.anchorPath);
                          }}
                        >
                          <circle r={node.radius + 6} fill={node.color} opacity={0.12} />
                          <circle r={node.radius} fill={node.color} opacity={0.9} stroke="var(--color-graph-node-ring)" strokeWidth={1.5} />
                          {showLabel && (
                            <>
                              <text
                                x="0"
                                y="-2"
                                textAnchor="middle"
                                fontSize="12"
                                fill="var(--color-graph-node-text)"
                                stroke="var(--color-graph-label-bg)"
                                strokeWidth="3"
                                paintOrder="stroke"
                                fontWeight="700"
                              >
                                {node.label.length > 14 ? `${node.label.slice(0, 14)}…` : node.label}
                              </text>
                              <text
                                x="0"
                                y="13"
                                textAnchor="middle"
                                fontSize="10"
                                fill="var(--color-graph-node-text)"
                                stroke="var(--color-graph-label-bg)"
                                strokeWidth="2.5"
                                paintOrder="stroke"
                              >
                                {node.fileCount} files
                              </text>
                            </>
                          )}
                          {node.attentionCount > 0 && (
                            <circle cx={node.radius - 4} cy={-node.radius + 4} r="7" fill="var(--color-p1)" />
                          )}
                          {node.attentionCount > 0 && (
                            <text x={node.radius - 4} y={-node.radius + 8} textAnchor="middle" fontSize="9" fill="var(--color-text-on-accent)" fontWeight="700">
                              {node.attentionCount}
                            </text>
                          )}
                          <title>{`${node.label}: ${node.fileCount} files, ${node.openTodoCount} open TODOs`}</title>
                        </g>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {focusGraph.edges.map(edge => {
                      const source = focusNodeMap.get(edge.source);
                      const target = focusNodeMap.get(edge.target);
                      if (!source || !target) return null;
                      const touchesCenter = source.hop === 0 || target.hop === 0;
                      const edgeIsHovered = Boolean(hoveredFocusPath && (edge.source === hoveredFocusPath || edge.target === hoveredFocusPath));
                      const edgeOpacity = hoveredFocusPath
                        ? edgeIsHovered ? 0.86 : 0.09
                        : touchesCenter ? 0.72 : 0.32;
                      const showLabel = shouldShowFocusRelationLabel({
                        relation: edge.relation,
                        showEdgeLabels,
                        activePath: hoveredFocusPath,
                        source: edge.source,
                        target: edge.target,
                        touchesCenter,
                      });
                      const deltaX = target.x - source.x;
                      const deltaY = target.y - source.y;
                      const length = Math.hypot(deltaX, deltaY) || 1;
                      const labelX = Number((((source.x + target.x) / 2) + ((-deltaY / length) * 12)).toFixed(3));
                      const labelY = Number((((source.y + target.y) / 2) + ((deltaX / length) * 12)).toFixed(3));
                      return (
                        <g key={edge.id}>
                          <line
                            x1={source.x}
                            y1={source.y}
                            x2={target.x}
                            y2={target.y}
                            stroke={edge.closeness != null ? `var(--color-closeness-${Math.max(1, Math.min(5, edge.closeness))})` : 'var(--color-border)'}
                            strokeWidth={(edgeIsHovered ? 1.5 : 1) + ((edge.closeness ?? 2) * 0.6)}
                            opacity={edgeOpacity}
                          />
                          {showLabel && (
                            <text
                              x={labelX}
                              y={labelY}
                              textAnchor="middle"
                              fontSize="9"
                              fill="var(--color-text-secondary)"
                              stroke="var(--color-graph-label-bg)"
                              strokeWidth="3"
                              paintOrder="stroke"
                              opacity={edgeIsHovered ? 0.96 : touchesCenter ? 0.9 : 0.7}
                            >
                              {edge.relation}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {focusGraph.nodes.map(node => {
                      const isCenter = node.path === focusGraph.centerFile?.path;
                      const isHovered = hoveredFocusPath === node.path;
                      const isHoverNeighbor = focusHoverNeighborhood.has(node.path);
                      const isDimmed = Boolean(hoveredFocusPath && !isHoverNeighbor);
                      const showLabel = focusLabelIds.has(node.id) || isHoverNeighbor;
                      const baseNodeOpacity = isCenter ? 1 : Math.max(0.46, 0.9 - (node.hop * 0.18));
                      const nodeOpacity = isDimmed ? 0.22 : isHovered ? 1 : baseNodeOpacity;
                      return (
                        <g
                          key={node.id}
                          transform={`translate(${node.x} ${node.y})`}
                          className={draggingNodePath === node.path ? 'cursor-grabbing' : 'cursor-grab'}
                          onPointerDown={event => handleNodePointerDown(event, node)}
                          onPointerEnter={() => setHoveredFocusPath(node.path)}
                          onPointerLeave={() => setHoveredFocusPath(current => current === node.path ? null : current)}
                          onClick={() => {
                            if (suppressNextNodeClick.current === node.path) {
                              suppressNextNodeClick.current = null;
                              return;
                            }
                            setFocusPath(node.path);
                            void selectFile(node.path);
                          }}
                        >
                          <circle
                            r={node.radius + (isCenter ? 10 : 5)}
                            fill={node.color}
                            opacity={isDimmed ? 0.02 : isHovered ? 0.28 : isCenter ? 0.24 : 0.08}
                          />
                          <circle
                            r={node.radius}
                            fill={node.color}
                            opacity={isCenter ? Math.max(0.5, nodeOpacity) : nodeOpacity}
                            stroke={isHovered ? 'var(--color-accent)' : isCenter ? 'var(--color-graph-node-ring)' : 'var(--color-border)'}
                            strokeWidth={isHovered ? 2.6 : isCenter ? 2.4 : 1.1}
                          />
                          {showLabel && (
                            <text
                              x="0"
                              y="4"
                              textAnchor="middle"
                              fontSize={isCenter ? '12' : '10'}
                              fill="var(--color-graph-node-text)"
                              stroke="var(--color-graph-label-bg)"
                              strokeWidth={isCenter ? '3' : '2.5'}
                              paintOrder="stroke"
                              fontWeight={isCenter ? '700' : '500'}
                              opacity={isCenter ? 1 : nodeOpacity}
                            >
                              {node.label.length > 16 ? `${node.label.slice(0, 16)}…` : node.label}
                            </text>
                          )}
                          <title>{node.path}</title>
                        </g>
                      );
                    })}
                  </>
                )}
              </g>
            </g>
          </svg>
        </div>
      </main>
    </div>
  );
}
