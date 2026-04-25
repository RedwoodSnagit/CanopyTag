import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import type { AgentManifestEntry, Author, MergedFileRecord, Priority } from '../../shared/types';
import { checkAuthorityHealth, normalizeAuthor } from '../../shared/types';
import { useWorkspace } from '../stores/workspace';
import { PRIORITY_COLORS } from '../lib/tokens';
import { api } from '../lib/api';
import { formatAuthorityLabel } from '../lib/authority';

type TableMode = 'files' | 'scores' | 'todos' | 'activity';
type ScoreFocus = 'all' | 'attention' | 'unreviewed' | 'underscored' | 'promotion' | 'low-stability';
type ScoreHealthStatus = 'healthy' | 'underscored' | 'promotion-candidate' | 'unscored' | 'no-authority';
type ManifestRecency = 'all' | '7d' | '30d' | '90d';
type SortDirection = false | 'asc' | 'desc';

const TABLE_HEADER_CLASS = 'cursor-pointer select-none border-b border-border px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary';
const TABLE_ROW_CLASS = 'cursor-pointer border-b border-border/60 transition-colors hover:bg-surface-hover/60';
const TABLE_EXPANDED_ROW_CLASS = 'bg-surface-hover/40';
const TABLE_EMPTY_CLASS = 'mt-8 text-center text-sm text-text-muted';
const TEXT_PRIMARY_CLASS = 'text-xs text-text-primary';
const TEXT_SECONDARY_CLASS = 'text-xs text-text-secondary';
const TEXT_MUTED_CLASS = 'text-xs text-text-muted';
const MONO_PRIMARY_CLASS = 'font-mono text-xs text-text-primary';
const MONO_SECONDARY_CLASS = 'font-mono text-xs text-text-secondary';
const MONO_MUTED_CLASS = 'font-mono text-[10px] text-text-muted';
const STATUS_SUCCESS_CLASS = 'border-[var(--color-status-success-border)] bg-[var(--color-status-success-bg)] text-[var(--color-status-success-text)]';
const STATUS_INFO_CLASS = 'border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)] text-[var(--color-status-info-text)]';
const STATUS_WARNING_CLASS = 'border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]';
const STATUS_DANGER_CLASS = 'border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]';
const STATUS_PURPLE_CLASS = 'border-[var(--color-status-purple-border)] bg-[var(--color-status-purple-bg)] text-[var(--color-status-purple-text)]';
const STATUS_NEUTRAL_CLASS = 'border-[var(--color-status-neutral-border)] bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]';

interface TodoRow {
  todoId: string;
  text: string;
  priority: Priority;
  status: string;
  todoTags: string[];
  createdBy: Author;
  createdAt: string;
  filePath: string;
  difficulty?: number;
  fileTags: string[];
  authority: string | undefined;
  fileStatus: string | undefined;
}

interface ScoreRow {
  path: string;
  authority: string | undefined;
  fileStatus: string | undefined;
  reviewed: boolean;
  healthStatus: ScoreHealthStatus;
  aggregate: number;
  average: number;
  scoreCount: number;
  validity: number | null;
  clarity: number | null;
  completeness: number | null;
  stability: number | null;
  openTodoCount: number;
  highestPriority?: Priority;
}

interface ManifestRow {
  id: string;
  file: string;
  createdAt: string;
  status: string;
  kinds: string;
  preview: string;
  followUps: string;
  entry: AgentManifestEntry;
}

const SCORE_FOCUS_LABELS: Record<ScoreFocus, string> = {
  all: 'All',
  attention: 'Needs Attention',
  unreviewed: 'Unreviewed',
  underscored: 'Underscored',
  promotion: 'Promotion',
  'low-stability': 'Low Stability',
};

const MANIFEST_RECENCY_LABELS: Record<ManifestRecency, string> = {
  all: 'All',
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
};

const fileColumnHelper = createColumnHelper<MergedFileRecord>();
const todoColumnHelper = createColumnHelper<TodoRow>();
const scoreColumnHelper = createColumnHelper<ScoreRow>();
const manifestColumnHelper = createColumnHelper<ManifestRow>();

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="rounded border border-border bg-surface-hover px-1 py-0.5 text-[9px] text-text-muted">
      {tag}
    </span>
  );
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}

function ChevronIcon({
  direction,
  className = 'h-3 w-3',
}: {
  direction: 'up' | 'down' | 'right';
  className?: string;
}) {
  const path = direction === 'up'
    ? 'M3.5 10L8 5.5 12.5 10'
    : direction === 'down'
      ? 'M3.5 6L8 10.5 12.5 6'
      : 'M6 3.5L10.5 8 6 12.5';
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={path} />
    </svg>
  );
}

function SortIndicator({ direction }: { direction: SortDirection }) {
  if (!direction) return null;
  return <ChevronIcon direction={direction === 'asc' ? 'up' : 'down'} className="h-3 w-3 text-text-secondary" />;
}

function fileStatusTone(status?: string): string {
  switch (status) {
    case 'active':
      return STATUS_SUCCESS_CLASS;
    case 'draft':
      return STATUS_INFO_CLASS;
    case 'experimental':
      return STATUS_PURPLE_CLASS;
    case 'deprecated':
      return STATUS_WARNING_CLASS;
    case 'superseded':
      return STATUS_DANGER_CLASS;
    case 'archived':
      return STATUS_NEUTRAL_CLASS;
    default:
      return STATUS_NEUTRAL_CLASS;
  }
}

function authorityLabel(value?: string): string {
  return formatAuthorityLabel(value, true);
}

function scoreTone(status: ScoreHealthStatus): string {
  switch (status) {
    case 'underscored':
      return STATUS_WARNING_CLASS;
    case 'promotion-candidate':
      return STATUS_INFO_CLASS;
    case 'healthy':
      return STATUS_SUCCESS_CLASS;
    case 'no-authority':
      return STATUS_PURPLE_CLASS;
    default:
      return STATUS_NEUTRAL_CLASS;
  }
}

function reviewedTone(reviewed: boolean): string {
  return reviewed
    ? STATUS_SUCCESS_CLASS
    : STATUS_WARNING_CLASS;
}

function manifestStatusTone(status: string): string {
  switch (status) {
    case 'pending':
      return STATUS_WARNING_CLASS;
    case 'agreed':
      return STATUS_SUCCESS_CLASS;
    case 'fixed':
      return STATUS_INFO_CLASS;
    case 'rejected':
      return STATUS_NEUTRAL_CLASS;
    default:
      return STATUS_NEUTRAL_CLASS;
  }
}

export function formatSuggestedFreshness(value?: AgentManifestEntry['suggestedFreshness']): string {
  switch (value) {
    case 'fresh':
      return 'Fresh';
    case 'review-drift':
      return 'Review Drift';
    case 'unknown':
      return 'Unknown';
    case 'stale':
      return 'Stale';
    default:
      return '-';
  }
}

export function buildManifestKinds(entry: AgentManifestEntry): string {
  const kinds: string[] = [];
  if (entry.applied === true) kinds.push('Applied');
  if (entry.applied === false) kinds.push('Staged');
  if (entry.kind === 'annotate' || entry.proposal) kinds.push('Meta');
  if (entry.kind === 'comment' || entry.comment) kinds.push('Comment');
  if (entry.kind === 'todo' || entry.todo) kinds.push('TODO');
  if (entry.kind === 'rename-tag') kinds.push('Rename');
  if (entry.kind === 'suggestion') kinds.push('Suggestion');
  if (entry.suggestedFreshness) kinds.push(formatSuggestedFreshness(entry.suggestedFreshness));
  if (entry.followUps?.length) kinds.push('Follow-up');
  return kinds.join(', ') || 'Note';
}

export function buildManifestPreview(entry: AgentManifestEntry): string {
  const parts: string[] = [];
  if (entry.headline) {
    parts.push(entry.headline);
  }
  if (entry.proposal?.summary) {
    parts.push(entry.proposal.summary);
  }
  if (entry.comment) {
    parts.push(`Comment: ${entry.comment}`);
  }
  if (entry.todo?.text) {
    parts.push(`TODO: ${entry.todo.text}`);
  }
  if (parts.length === 0 && entry.proposal) {
    const metaParts: string[] = [];
    if (entry.proposal.tags?.length) metaParts.push(`tags ${entry.proposal.tags.join(', ')}`);
    if (entry.proposal.authorityLevel) metaParts.push(`authority ${authorityLabel(entry.proposal.authorityLevel)}`);
    if (entry.proposal.fileStatus) metaParts.push(`status ${entry.proposal.fileStatus}`);
    if (entry.proposal.featureId) metaParts.push(`feature ${entry.proposal.featureId}`);
    if (metaParts.length > 0) {
      parts.push(metaParts.join(' | '));
    }
  }
  if (entry.followUps?.length) {
    const preview = entry.followUps.slice(0, 2).join(', ');
    const suffix = entry.followUps.length > 2 ? ` +${entry.followUps.length - 2}` : '';
    parts.push(`Follow-ups: ${preview}${suffix}`);
  }
  if (entry.rationale) {
    parts.push(`Why: ${entry.rationale}`);
  }
  if (entry.reviewNote) {
    parts.push(`Review: ${entry.reviewNote}`);
  }
  return parts.join(' • ') || 'No activity detail.';
}

export function toManifestRow(entry: AgentManifestEntry): ManifestRow {
  return {
    id: entry.id,
    file: entry.file,
    createdAt: entry.createdAt,
    status: entry.status,
    kinds: buildManifestKinds(entry),
    preview: buildManifestPreview(entry),
    followUps: entry.followUps?.join(', ') ?? '-',
    entry,
  };
}

export function filterManifestRowsByRecency(
  rows: ManifestRow[],
  recency: ManifestRecency,
  now: Date = new Date(),
): ManifestRow[] {
  if (recency === 'all') return rows;

  const days = recency === '7d' ? 7 : recency === '30d' ? 30 : 90;
  const cutoff = now.getTime() - (days * 24 * 60 * 60 * 1000);

  return rows.filter((row) => {
    const createdAt = new Date(row.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}

function manifestRecencyCounts(rows: ManifestRow[], now: Date = new Date()): Record<ManifestRecency, number> {
  return {
    all: rows.length,
    '7d': filterManifestRowsByRecency(rows, '7d', now).length,
    '30d': filterManifestRowsByRecency(rows, '30d', now).length,
    '90d': filterManifestRowsByRecency(rows, '90d', now).length,
  };
}

function formatScore(value: number | null, scale: number): string {
  if (value == null) return '-';
  return scale === 20 ? `${value}/20` : `${value.toFixed(1)}/5`;
}

function hasScoreMetadata(file: MergedFileRecord): boolean {
  return Boolean(
    file.authorityLevel ||
    file.validity != null ||
    file.clarity != null ||
    file.completeness != null ||
    file.stability != null ||
    file.scoresReviewed != null
  );
}

function toScoreRow(file: MergedFileRecord): ScoreRow {
  const values = [file.validity, file.clarity, file.completeness, file.stability]
    .filter((value): value is number => value != null);
  const aggregate = values.reduce((sum, value) => sum + value, 0);
  const average = values.length > 0 ? aggregate / values.length : 0;
  const authorityHealth = file.authorityHealth ?? checkAuthorityHealth(file);

  let healthStatus: ScoreHealthStatus;
  if (authorityHealth) {
    healthStatus = authorityHealth.status;
  } else if (file.authorityLevel) {
    healthStatus = values.length > 0 ? 'healthy' : 'unscored';
  } else {
    healthStatus = 'no-authority';
  }

  return {
    path: file.path,
    authority: file.authorityLevel,
    fileStatus: file.status,
    reviewed: file.scoresReviewed === true,
    healthStatus,
    aggregate,
    average,
    scoreCount: values.length,
    validity: file.validity ?? null,
    clarity: file.clarity ?? null,
    completeness: file.completeness ?? null,
    stability: file.stability ?? null,
    openTodoCount: file.openTodoCount,
    highestPriority: file.highestPriority,
  };
}

function scoreNeedsAttention(row: ScoreRow): boolean {
  return (
    !row.reviewed ||
    row.healthStatus === 'underscored' ||
    row.healthStatus === 'promotion-candidate' ||
    row.healthStatus === 'no-authority' ||
    (row.stability != null && row.stability <= 2)
  );
}

function filterScoreRows(rows: ScoreRow[], focus: ScoreFocus): ScoreRow[] {
  switch (focus) {
    case 'attention':
      return rows.filter(scoreNeedsAttention);
    case 'unreviewed':
      return rows.filter(row => !row.reviewed);
    case 'underscored':
      return rows.filter(row => row.healthStatus === 'underscored');
    case 'promotion':
      return rows.filter(row => row.healthStatus === 'promotion-candidate');
    case 'low-stability':
      return rows.filter(row => row.stability != null && row.stability <= 2);
    default:
      return rows;
  }
}

function scoreSummary(rows: ScoreRow[]): Record<ScoreFocus, number> {
  return {
    all: rows.length,
    attention: rows.filter(scoreNeedsAttention).length,
    unreviewed: rows.filter(row => !row.reviewed).length,
    underscored: rows.filter(row => row.healthStatus === 'underscored').length,
    promotion: rows.filter(row => row.healthStatus === 'promotion-candidate').length,
    'low-stability': rows.filter(row => row.stability != null && row.stability <= 2).length,
  };
}

function FileTable({ data, onRowClick }: { data: MergedFileRecord[]; onRowClick: (path: string) => void }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const columns = useMemo(
    () => [
      fileColumnHelper.display({
        id: 'expand',
        header: '',
        cell: ({ row }) => {
          const count = row.original.todos.length;
          if (count === 0) return <span className="w-4" />;
          return (
            <button
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(prev => ({ ...prev, [row.original.path]: !prev[row.original.path] }));
              }}
              className="inline-flex h-4 w-4 items-center justify-center text-text-muted hover:text-text-primary"
              aria-label={expanded[row.original.path] ? 'Collapse TODOs' : 'Expand TODOs'}
            >
              <ChevronIcon direction={expanded[row.original.path] ? 'down' : 'right'} />
            </button>
          );
        },
        size: 24,
      }),
      fileColumnHelper.accessor('path', {
        header: 'Path',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue()}</span>,
      }),
      fileColumnHelper.accessor('extension', {
        header: 'Ext',
        cell: info => {
          const value = info.getValue();
          return value ? <span className={MONO_SECONDARY_CLASS}>{value}</span> : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
      fileColumnHelper.accessor('kind', {
        header: 'Kind',
        cell: info => {
          const value = info.getValue();
          return value ? <span className={TEXT_SECONDARY_CLASS}>{value}</span> : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
      fileColumnHelper.accessor('summary', {
        header: 'Summary',
        cell: info => {
          const value = info.getValue();
          return (
            <span className={TEXT_SECONDARY_CLASS}>
              {value ? (value.length > 60 ? `${value.slice(0, 60)}...` : value) : '-'}
            </span>
          );
        },
      }),
      fileColumnHelper.accessor('authorityLevel', {
        header: 'Authority',
        cell: info => {
          const value = info.getValue();
          return value ? <span className={TEXT_SECONDARY_CLASS}>{authorityLabel(value)}</span> : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
      fileColumnHelper.accessor('status', {
        header: 'Status',
        cell: info => {
          const value = info.getValue();
          return value
            ? <StatusBadge label={value} className={fileStatusTone(value)} />
            : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
      fileColumnHelper.accessor('openTodoCount', {
        header: 'TODOs',
        cell: info => {
          const count = info.getValue();
          return count > 0 ? <span className="text-xs font-semibold text-text-primary">{count}</span> : <span className={TEXT_MUTED_CLASS}>0</span>;
        },
      }),
      fileColumnHelper.accessor('highestPriority', {
        header: 'Priority',
        cell: info => {
          const value = info.getValue();
          return value ? (
            <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[value] }}>
              P{value}
            </span>
          ) : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
    ],
    [expanded]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <>
      <input
        type="text"
        value={globalFilter}
        onChange={event => setGlobalFilter(event.target.value)}
        placeholder="Filter files..."
        className="mb-3 w-64 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-canvas">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={TABLE_HEADER_CLASS}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIndicator direction={header.column.getIsSorted() as SortDirection} />
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <Fragment key={row.id}>
                <tr
                  onClick={() => onRowClick(row.original.path)}
                  className={TABLE_ROW_CLASS}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-2 py-1.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {expanded[row.original.path] && row.original.todos.map(todo => (
                  <tr key={`${row.id}-${todo.id}`} className={TABLE_EXPANDED_ROW_CLASS}>
                    <td className="px-2 py-1" />
                    <td colSpan={2} className="px-2 py-1">
                      <span className={MONO_MUTED_CLASS}>{todo.id}</span>
                    </td>
                    <td colSpan={3} className="px-2 py-1">
                      <span className={`text-xs ${todo.status === 'done' ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                        {todo.text}
                      </span>
                      {todo.tags && todo.tags.length > 0 && (
                        <span className="ml-2 inline-flex gap-1">
                          {todo.tags.map(tag => (
                            <TagBadge key={tag} tag={tag} />
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-xs capitalize text-text-muted">{todo.status}</span>
                    </td>
                    <td />
                    <td className="px-2 py-1">
                      <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[todo.priority] }}>
                        P{todo.priority}
                      </span>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data.length === 0 && (
          <p className={TABLE_EMPTY_CLASS}>
            No annotated files yet. Select a file in Explorer to add metadata.
          </p>
        )}
      </div>
    </>
  );
}

function ScoreTable({ scoreRows, onRowClick }: { scoreRows: ScoreRow[]; onRowClick: (path: string) => void }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'aggregate', desc: false },
    { id: 'path', desc: false },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [focus, setFocus] = useState<ScoreFocus>('all');

  const counts = useMemo(() => scoreSummary(scoreRows), [scoreRows]);
  const filteredRows = useMemo(() => filterScoreRows(scoreRows, focus), [focus, scoreRows]);

  const columns = useMemo(
    () => [
      scoreColumnHelper.accessor('path', {
        header: 'Path',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue()}</span>,
      }),
      scoreColumnHelper.accessor('authority', {
        header: 'Authority',
        cell: info => <span className={TEXT_SECONDARY_CLASS}>{authorityLabel(info.getValue())}</span>,
      }),
      scoreColumnHelper.accessor('fileStatus', {
        header: 'File',
        cell: info => {
          const value = info.getValue();
          return value
            ? <StatusBadge label={value} className={fileStatusTone(value)} />
            : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
      scoreColumnHelper.accessor('healthStatus', {
        header: 'Health',
        cell: info => (
          <StatusBadge label={info.getValue().replace('-', ' ')} className={scoreTone(info.getValue())} />
        ),
      }),
      scoreColumnHelper.accessor('reviewed', {
        header: 'Reviewed',
        cell: info => (
          <StatusBadge label={info.getValue() ? 'reviewed' : 'unreviewed'} className={reviewedTone(info.getValue())} />
        ),
      }),
      scoreColumnHelper.accessor('aggregate', {
        header: 'Aggregate',
        cell: info => {
          const row = info.row.original;
          return <span className={MONO_PRIMARY_CLASS}>{row.scoreCount > 0 ? formatScore(info.getValue(), 20) : '-'}</span>;
        },
      }),
      scoreColumnHelper.accessor('average', {
        header: 'Average',
        cell: info => {
          const row = info.row.original;
          return <span className={MONO_SECONDARY_CLASS}>{row.scoreCount > 0 ? formatScore(info.getValue(), 5) : '-'}</span>;
        },
      }),
      scoreColumnHelper.accessor('validity', {
        header: 'Validity',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue() ?? '-'}</span>,
      }),
      scoreColumnHelper.accessor('clarity', {
        header: 'Clarity',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue() ?? '-'}</span>,
      }),
      scoreColumnHelper.accessor('completeness', {
        header: 'Complete',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue() ?? '-'}</span>,
      }),
      scoreColumnHelper.accessor('stability', {
        header: 'Stable',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue() ?? '-'}</span>,
      }),
      scoreColumnHelper.accessor('openTodoCount', {
        header: 'TODOs',
        cell: info => <span className="text-xs font-semibold text-text-primary">{info.getValue()}</span>,
      }),
      scoreColumnHelper.accessor('highestPriority', {
        header: 'Priority',
        cell: info => {
          const value = info.getValue();
          return value ? (
            <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[value] }}>
              P{value}
            </span>
          ) : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
      }),
    ],
    []
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={globalFilter}
          onChange={event => setGlobalFilter(event.target.value)}
          placeholder="Filter scores, paths, health, status..."
          className="w-72 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
        />
        <span className="text-xs text-text-muted">
          {counts.all} score rows, {counts.attention} need attention
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(SCORE_FOCUS_LABELS) as ScoreFocus[]).map(value => (
          <button
            key={value}
            onClick={() => setFocus(value)}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              focus === value
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary'
            }`}
          >
            {SCORE_FOCUS_LABELS[value]}
            <span className="ml-1 text-text-secondary">({counts[value]})</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-canvas">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={TABLE_HEADER_CLASS}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIndicator direction={header.column.getIsSorted() as SortDirection} />
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.original.path)}
                className={TABLE_ROW_CLASS}
              >
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-2 py-1.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {scoreRows.length === 0 && (
          <p className={TABLE_EMPTY_CLASS}>
            No score metadata yet. Set authority or score files from the Explorer view.
          </p>
        )}
        {scoreRows.length > 0 && filteredRows.length === 0 && (
          <p className={TABLE_EMPTY_CLASS}>
            No score rows match the current filter.
          </p>
        )}
      </div>
    </>
  );
}

function TodoTable({ todoRows, onRowClick }: { todoRows: TodoRow[]; onRowClick: (path: string) => void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'priority', desc: false }]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns = useMemo(
    () => [
      todoColumnHelper.accessor('priority', {
        header: 'Priority',
        cell: info => (
          <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[info.getValue()] }}>
            P{info.getValue()}
          </span>
        ),
        size: 60,
      }),
      todoColumnHelper.accessor('difficulty', {
        header: 'Difficulty',
        cell: info => (info.getValue() ? `D${info.getValue()}` : '-'),
        size: 80,
      }),
      todoColumnHelper.accessor('text', {
        header: 'TODO',
        cell: info => (
          <span className={`text-xs ${info.row.original.status === 'done' ? 'text-text-muted line-through' : 'text-text-primary'}`}>
            {info.getValue()}
          </span>
        ),
      }),
      todoColumnHelper.accessor('status', {
        header: 'Status',
        cell: info => <span className="text-xs capitalize text-text-secondary">{info.getValue()}</span>,
        size: 80,
      }),
      todoColumnHelper.accessor('todoTags', {
        header: 'Tags',
        cell: info => {
          const tags = info.getValue();
          return tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <TagBadge key={tag} tag={tag} />
              ))}
            </div>
          ) : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
        filterFn: (row, _columnId, filterValue: string) => {
          if (!filterValue) return true;
          const lower = filterValue.toLowerCase();
          return (
            row.original.todoTags.some(tag => tag.toLowerCase().includes(lower)) ||
            row.original.fileTags.some(tag => tag.toLowerCase().includes(lower))
          );
        },
      }),
      todoColumnHelper.accessor('filePath', {
        header: 'File',
        cell: info => <span className={MONO_SECONDARY_CLASS}>{info.getValue()}</span>,
      }),
      todoColumnHelper.accessor('createdBy', {
        header: 'By',
        cell: info => {
          const signature = normalizeAuthor(info.getValue());
          return <span className="text-[10px] text-text-muted">{signature.name ?? signature.role}</span>;
        },
        size: 50,
      }),
      todoColumnHelper.accessor('authority', {
        header: 'Authority',
        cell: info => {
          const value = info.getValue();
          return value ? <span className={TEXT_SECONDARY_CLASS}>{authorityLabel(value)}</span> : <span className={TEXT_MUTED_CLASS}>-</span>;
        },
        size: 80,
      }),
      todoColumnHelper.accessor('createdAt', {
        header: 'Created',
        cell: info => <span className={MONO_MUTED_CLASS}>{info.getValue()}</span>,
        size: 80,
      }),
    ],
    []
  );

  const table = useReactTable({
    data: todoRows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <>
      <input
        type="text"
        value={globalFilter}
        onChange={event => setGlobalFilter(event.target.value)}
        placeholder="Filter TODOs, tags, files..."
        className="mb-3 w-64 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-canvas">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={TABLE_HEADER_CLASS}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIndicator direction={header.column.getIsSorted() as SortDirection} />
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.original.filePath)}
                className={TABLE_ROW_CLASS}
              >
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-2 py-1.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {todoRows.length === 0 && (
          <p className={TABLE_EMPTY_CLASS}>
            No TODOs yet. Add them from the Explorer view.
          </p>
        )}
      </div>
    </>
  );
}

function ManifestTable({
  rows,
  loading,
  error,
  onRowClick,
  onRefresh,
  onReview,
}: {
  rows: ManifestRow[];
  loading: boolean;
  error: string | null;
  onRowClick: (path: string) => void;
  onRefresh: () => void;
  onReview: (id: string, action: 'agree' | 'fix' | 'reject', note?: string) => Promise<void>;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [recency, setRecency] = useState<ManifestRecency>('30d');
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const counts = useMemo(() => manifestRecencyCounts(rows), [rows]);
  const filteredRows = useMemo(() => filterManifestRowsByRecency(rows, recency), [recency, rows]);

  const handleReview = async (id: string, action: 'agree' | 'fix' | 'reject', note?: string) => {
    setReviewingId(id);
    try {
      await onReview(id, action, note);
      if (action === 'fix') {
        setFixingId(null);
        setFixNote('');
      }
    } finally {
      setReviewingId(null);
    }
  };

  const columns = useMemo(
    () => [
      manifestColumnHelper.accessor('createdAt', {
        header: 'Created',
        cell: info => <span className={MONO_MUTED_CLASS}>{info.getValue()}</span>,
      }),
      manifestColumnHelper.accessor('file', {
        header: 'File',
        cell: info => <span className={MONO_PRIMARY_CLASS}>{info.getValue()}</span>,
      }),
      manifestColumnHelper.accessor('status', {
        header: 'Status',
        cell: info => <StatusBadge label={info.getValue()} className={manifestStatusTone(info.getValue())} />,
      }),
      manifestColumnHelper.accessor('kinds', {
        header: 'Kinds',
        cell: info => <span className={TEXT_SECONDARY_CLASS}>{info.getValue()}</span>,
      }),
      manifestColumnHelper.accessor('preview', {
        header: 'Preview',
        cell: info => (
          <span className={TEXT_PRIMARY_CLASS}>
            {info.getValue().length > 120 ? `${info.getValue().slice(0, 120)}...` : info.getValue()}
          </span>
        ),
      }),
      manifestColumnHelper.accessor('followUps', {
        header: 'Follow-ups',
        cell: info => {
          const value = info.getValue();
          return value === '-'
            ? <span className={TEXT_MUTED_CLASS}>-</span>
            : <span className={TEXT_SECONDARY_CLASS}>{value}</span>;
        },
      }),
      manifestColumnHelper.display({
        id: 'review',
        header: 'Review',
        cell: ({ row }) => {
          const entry = row.original.entry;
          const isBusy = reviewingId === entry.id;
          if (entry.status !== 'pending') {
            return (
              <span className="text-xs text-text-muted">
                {entry.reviewNote ? 'Reviewed with note' : 'Reviewed'}
              </span>
            );
          }
          return (
            <div className="flex flex-wrap gap-1" onClick={event => event.stopPropagation()}>
              <button
                disabled={isBusy}
                onClick={() => { void handleReview(entry.id, 'agree'); }}
                className={`rounded border px-2 py-1 text-[10px] transition-colors hover:brightness-110 disabled:opacity-60 ${STATUS_SUCCESS_CLASS}`}
              >
                Agree
              </button>
              <button
                disabled={isBusy}
                onClick={() => {
                  setFixingId(entry.id);
                  setFixNote(entry.reviewNote ?? '');
                }}
                className={`rounded border px-2 py-1 text-[10px] transition-colors hover:brightness-110 disabled:opacity-60 ${STATUS_INFO_CLASS}`}
              >
                Fix
              </button>
              <button
                disabled={isBusy || entry.canReject === false}
                onClick={() => {
                  if (window.confirm('Reject this agent change and revert it from canopy.json?')) {
                    void handleReview(entry.id, 'reject');
                  }
                }}
                className="rounded border border-border bg-surface px-2 py-1 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-text-primary disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          );
        },
      }),
    ],
    [reviewingId, fixNote]
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={globalFilter}
          onChange={event => setGlobalFilter(event.target.value)}
          placeholder="Filter activity by file, kind, preview..."
          className="w-80 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
        />
        <button
          onClick={onRefresh}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
        >
          Refresh
        </button>
        <span className="text-xs text-text-muted">
          Agent writes stay live immediately; this lane is the human review feed.
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(MANIFEST_RECENCY_LABELS) as ManifestRecency[]).map((value) => (
          <button
            key={value}
            onClick={() => setRecency(value)}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              recency === value
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary'
            }`}
          >
            {MANIFEST_RECENCY_LABELS[value]}
            <span className="ml-1 text-text-secondary">({counts[value]})</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 text-sm text-error">{error}</p>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-canvas">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={TABLE_HEADER_CLASS}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIndicator direction={header.column.getIsSorted() as SortDirection} />
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <Fragment key={row.id}>
                <tr
                  onClick={() => onRowClick(row.original.file)}
                  className={TABLE_ROW_CLASS}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-2 py-1.5 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {fixingId === row.original.id && row.original.entry.status === 'pending' && (
                  <tr className="bg-surface-hover/40">
                    <td colSpan={row.getVisibleCells().length} className="px-3 py-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={fixNote}
                          onChange={event => setFixNote(event.target.value)}
                          placeholder="Explain the fix as a human comment..."
                          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={reviewingId === row.original.id || fixNote.trim().length === 0}
                            onClick={() => { void handleReview(row.original.id, 'fix', fixNote); }}
                            className={`rounded border px-2 py-1 text-xs transition-colors hover:brightness-110 disabled:opacity-50 ${STATUS_INFO_CLASS}`}
                          >
                            Save Fix
                          </button>
                          <button
                            onClick={() => {
                              setFixingId(null);
                              setFixNote('');
                            }}
                            className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <p className={TABLE_EMPTY_CLASS}>
            No agent activity yet.
          </p>
        )}
        {!loading && rows.length > 0 && filteredRows.length === 0 && (
          <p className={TABLE_EMPTY_CLASS}>
            No activity entries match the current recency window.
          </p>
        )}
        {loading && (
          <p className={TABLE_EMPTY_CLASS}>
            Loading activity entries...
          </p>
        )}
      </div>
    </>
  );
}

export function TableView() {
  const { index, selectFile, setViewMode, loadIndex } = useWorkspace();
  const [tableMode, setTableMode] = useState<TableMode>('files');
  const [manifestEntries, setManifestEntries] = useState<AgentManifestEntry[]>([]);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const loadManifest = async () => {
    setManifestLoading(true);
    setManifestError(null);
    try {
      const entries = await api.fetchActivity();
      setManifestEntries(entries);
    } catch (err: any) {
      setManifestError(err.message);
    } finally {
      setManifestLoading(false);
    }
  };

  useEffect(() => {
    void loadManifest();
  }, []);

  useEffect(() => {
    if (tableMode === 'activity') {
      void loadManifest();
    }
  }, [tableMode]);

  const fileData = useMemo(
    () =>
      index.filter(
        file =>
          file.todos.length > 0 ||
          file.comments.length > 0 ||
          Boolean(file.summary) ||
          file.validity != null ||
          file.clarity != null ||
          file.completeness != null ||
          file.stability != null
      ),
    [index]
  );

  const scoreRows = useMemo(
    () => index.filter(hasScoreMetadata).map(toScoreRow),
    [index]
  );

  const todoRows = useMemo<TodoRow[]>(() => {
    const rows: TodoRow[] = [];
    for (const file of index) {
      for (const todo of file.todos) {
        rows.push({
          todoId: todo.id,
          text: todo.text,
          priority: todo.priority,
          status: todo.status,
          difficulty: todo.difficulty,
          todoTags: todo.tags ?? [],
          createdBy: todo.createdBy,
          createdAt: todo.createdAt,
          filePath: file.path,
          fileTags: file.tags,
          authority: file.authorityLevel,
          fileStatus: file.status,
        });
      }
    }
    return rows;
  }, [index]);

  const openTodoCount = useMemo(
    () => todoRows.filter(row => row.status !== 'done').length,
    [todoRows]
  );

  const manifestRows = useMemo(
    () => manifestEntries.map(toManifestRow),
    [manifestEntries]
  );

  const handleRowClick = (path: string) => {
    selectFile(path);
    setViewMode('explorer');
  };

  const handleReview = async (id: string, action: 'agree' | 'fix' | 'reject', note?: string) => {
    setManifestError(null);
    try {
      await api.reviewActivity(id, action, note);
      await Promise.all([loadManifest(), loadIndex()]);
    } catch (err: any) {
      setManifestError(err.message);
      throw err;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setTableMode('files')}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            tableMode === 'files'
              ? 'bg-accent text-on-accent'
              : 'bg-surface text-text-muted hover:text-text-secondary'
          }`}
        >
          Files
        </button>
        <button
          onClick={() => setTableMode('scores')}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            tableMode === 'scores'
              ? 'bg-accent text-on-accent'
              : 'bg-surface text-text-muted hover:text-text-secondary'
          }`}
        >
          Scores {scoreRows.length > 0 && <span className="ml-1 text-text-secondary">({scoreRows.length})</span>}
        </button>
        <button
          onClick={() => setTableMode('todos')}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            tableMode === 'todos'
              ? 'bg-accent text-on-accent'
              : 'bg-surface text-text-muted hover:text-text-secondary'
          }`}
        >
          TODOs {todoRows.length > 0 && <span className="ml-1 text-text-secondary">({openTodoCount})</span>}
        </button>
        <button
          onClick={() => setTableMode('activity')}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            tableMode === 'activity'
              ? 'bg-accent text-on-accent'
              : 'bg-surface text-text-muted hover:text-text-secondary'
          }`}
        >
          Activity {manifestRows.length > 0 && <span className="ml-1 text-text-secondary">({manifestRows.length})</span>}
        </button>
      </div>

      {tableMode === 'files' ? (
        <FileTable data={fileData} onRowClick={handleRowClick} />
      ) : tableMode === 'scores' ? (
        <ScoreTable scoreRows={scoreRows} onRowClick={handleRowClick} />
      ) : tableMode === 'todos' ? (
        <TodoTable todoRows={todoRows} onRowClick={handleRowClick} />
      ) : (
        <ManifestTable
          rows={manifestRows}
          loading={manifestLoading}
          error={manifestError}
          onRowClick={handleRowClick}
          onRefresh={() => { void loadManifest(); }}
          onReview={handleReview}
        />
      )}
    </div>
  );
}
