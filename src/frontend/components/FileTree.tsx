import { useMemo, useRef, useState } from 'react';
import { Tree } from 'react-arborist';
import type { NodeRendererProps } from 'react-arborist';
import { useWorkspace } from '../stores/workspace';
import type { TreeNode, Priority, CanopyAnalytics, FileAnalytics } from '../../shared/types';
import { PRIORITY_COLORS } from '../lib/tokens';

// Shape passed to react-arborist — mirrors TreeNode but typed as the generic T
interface ArboristNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  children?: ArboristNode[];
}

interface BadgeInfo {
  todoCount: number;
  highestPriority: Priority | undefined;
}

interface HeatBreakdown {
  reads: number;
  edits: number;
  writes: number;
  queries: number;
  grepHits: number;
  globHits: number;
  ripgrepHits: number;
  score: number;
}

interface HeatInfo extends HeatBreakdown {
  maxScore: number;
  intensity: number;
}

const HEAT_WINDOW_DAYS = 7;

export function heatBreakdown(fa: FileAnalytics | undefined, windowDays = HEAT_WINDOW_DAYS): HeatBreakdown {
  if (!fa) {
    return {
      reads: 0,
      edits: 0,
      writes: 0,
      queries: 0,
      grepHits: 0,
      globHits: 0,
      ripgrepHits: 0,
      score: 0,
    };
  }
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  let reads = 0, edits = 0, writes = 0, queries = 0, grepHits = 0, globHits = 0, ripgrepHits = 0;
  for (const [date, bucket] of Object.entries(fa.days)) {
    if (date >= cutoff) {
      reads += bucket.readCount ?? 0;
      edits += bucket.editCount ?? 0;
      writes += bucket.writeCount ?? 0;
      queries += bucket.canopyQueryCount ?? 0;
      grepHits += bucket.grepHitCount ?? 0;
      globHits += bucket.globHitCount ?? 0;
      ripgrepHits += bucket.ripgrepHitCount ?? 0;
    }
  }
  return {
    reads,
    edits,
    writes,
    queries,
    grepHits,
    globHits,
    ripgrepHits,
    score: reads + (edits * 2) + (writes * 2) + queries + grepHits + globHits + ripgrepHits,
  };
}

export function buildHeatMap(analytics: CanopyAnalytics | null, windowDays = HEAT_WINDOW_DAYS): Map<string, HeatInfo> {
  const raw = new Map<string, HeatBreakdown>();
  if (!analytics) return new Map();

  for (const [filePath, fa] of Object.entries(analytics.files)) {
    raw.set(filePath, heatBreakdown(fa, windowDays));
  }

  const maxScore = Math.max(0, ...[...raw.values()].map(item => item.score));
  const heat = new Map<string, HeatInfo>();
  for (const [filePath, breakdown] of raw) {
    heat.set(filePath, {
      ...breakdown,
      maxScore,
      intensity: maxScore > 0 ? breakdown.score / maxScore : 0,
    });
  }
  return heat;
}

function heatTooltip(filePath: string, heat: HeatInfo | undefined): string {
  if (!heat || heat.score === 0) {
    return `${filePath}\nNo agent activity in the last ${HEAT_WINDOW_DAYS} days.`;
  }
  return [
    filePath,
    `${HEAT_WINDOW_DAYS}d heat: ${heat.score} / ${heat.maxScore}`,
    `${heat.reads} reads | ${heat.edits} edits | ${heat.writes} writes | ${heat.queries} queries`,
    `${heat.grepHits} grep hits | ${heat.globHits} glob hits | ${heat.ripgrepHits} rg hits`,
  ].join('\n');
}


function treeToArborist(nodes: TreeNode[]): ArboristNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    path: node.path,
    isFolder: node.isFolder,
    children: node.children ? treeToArborist(node.children) : undefined,
  }));
}


function PriorityDot({ priority }: { priority: Priority }) {
  return (
    <span
      style={{ color: PRIORITY_COLORS[priority] }}
      className="text-xs leading-none"
      aria-label={`Priority ${priority}`}
    >
      ●
    </span>
  );
}

function NodeBadge({ badge }: { badge: BadgeInfo }) {
  if (badge.todoCount === 0) return null;
  return (
    <span className="ml-auto flex items-center gap-1 shrink-0">
      {badge.highestPriority !== undefined && (
        <PriorityDot priority={badge.highestPriority} />
      )}
      <span className="text-xs text-forest-400 tabular-nums">
        {badge.todoCount}
      </span>
    </span>
  );
}

function HeatBar({ filePath, heat }: { filePath: string; heat: HeatInfo | undefined }) {
  const intensity = heat?.intensity ?? 0;
  const width = Math.max(0, Math.min(1, intensity)) * 100;
  const opacity = heat && heat.score > 0 ? Math.max(0.35, intensity) : 0;
  const tooltip = heatTooltip(filePath, heat);

  return (
    <span
      className="ml-1 w-10 h-1.5 rounded-full bg-border/40 overflow-hidden shrink-0"
      title={tooltip}
      aria-label={tooltip}
    >
      <span
        className="block h-full rounded-full bg-heat-high transition-all"
        style={{ width: `${width}%`, opacity }}
      />
    </span>
  );
}

function makeNode(
  badgeMap: Map<string, BadgeInfo>,
  onFileClick: (path: string) => void,
  onFolderClick: (path: string) => void,
  selectedPath: string | null,
  heatMap: Map<string, HeatInfo>,
  showHeat: boolean,
) {
  function Node({ node, style }: NodeRendererProps<ArboristNode>) {
    const isFolder = node.data.isFolder;
    const badge = badgeMap.get(node.data.path);
    const isActive = node.data.path === selectedPath;
    return (
      <div
        style={style}
        role="treeitem"
        tabIndex={0}
        aria-selected={isActive}
        aria-expanded={isFolder ? node.isOpen : undefined}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm
          ${isActive
            ? 'bg-forest-800 text-forest-100'
            : 'text-forest-300 hover:bg-forest-900 hover:text-forest-200'
          }`}
        onClick={() => {
          if (isFolder) {
            node.toggle();
            onFolderClick(node.data.path);
          } else {
            onFileClick(node.data.path);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isFolder) {
              node.toggle();
              onFolderClick(node.data.path);
            } else {
              onFileClick(node.data.path);
            }
          }
        }}
      >
        <span className="text-forest-500 w-4 text-center text-xs shrink-0">
          {isFolder ? (node.isOpen ? '▾' : '▸') : '·'}
        </span>
        <span className={`truncate flex-1 min-w-0 ${isFolder ? 'font-medium' : ''}`}>
          {node.data.name}
        </span>
        {badge && <NodeBadge badge={badge} />}
        {showHeat && !isFolder && (
          <HeatBar filePath={node.data.path} heat={heatMap.get(node.data.path)} />
        )}
      </div>
    );
  }
  return Node;
}

export function FileTree({ defaultShowHeat = false }: { defaultShowHeat?: boolean }) {
  const { tree, index, searchQuery, setSearchQuery, selectFile, selectDirectory, selectedPath, analytics } = useWorkspace();
  const [showHeat, setShowHeat] = useState(defaultShowHeat);
  const data = treeToArborist(tree);

  const badgeMap = useMemo(() => {
    const map = new Map<string, BadgeInfo>();
    for (const record of index) {
      if (record.openTodoCount > 0) {
        map.set(record.path, {
          todoCount: record.openTodoCount,
          highestPriority: record.highestPriority,
        });
      }
    }
    return map;
  }, [index]);

  const heatMap = useMemo(() => buildHeatMap(analytics), [analytics]);

  const handleFileClick = (path: string) => {
    void selectFile(path);
  };

  const handleFolderClick = (path: string) => {
    void selectDirectory(path);
  };

  const Node = useMemo(
    () => makeNode(badgeMap, handleFileClick, handleFolderClick, selectedPath, heatMap, showHeat),
    [badgeMap, selectedPath, heatMap, showHeat],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = containerRef.current?.clientWidth ?? 280;
  const containerHeight = containerRef.current?.clientHeight ?? 600;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 space-y-2">
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-2 py-1 text-sm rounded bg-surface border border-border
            text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          aria-pressed={showHeat}
          onClick={() => setShowHeat(value => !value)}
          className={`w-full px-2 py-1 rounded border text-xs font-medium transition-colors ${
            showHeat
              ? 'bg-accent text-on-accent border-accent'
              : 'bg-surface text-text-muted border-border hover:bg-surface-hover hover:text-text-secondary'
          }`}
        >
          {showHeat ? `Heat bars: ${HEAT_WINDOW_DAYS}d on` : `Show ${HEAT_WINDOW_DAYS}d heat bars`}
        </button>
      </div>
      <div className="flex-1 overflow-auto" ref={containerRef}>
        <Tree<ArboristNode>
          data={data}
          openByDefault={false}
          width={containerWidth}
          height={containerHeight}
          indent={16}
          rowHeight={32}
          searchTerm={searchQuery}
          searchMatch={(node, term) =>
            node.data.name.toLowerCase().includes(term.toLowerCase())
          }
        >
          {Node}
        </Tree>
      </div>
    </div>
  );
}
