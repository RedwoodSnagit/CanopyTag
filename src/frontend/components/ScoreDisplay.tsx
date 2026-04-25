import type { Author, MergedFileRecord, AuthorityLevel, FreshnessStatus } from '../../shared/types';
import { checkFreshness, normalizeAuthor } from '../../shared/types';
import { api } from '../lib/api';
import { AUTHORITY_HELP_TEXT, AUTHORITY_LEVELS, formatAuthorityLabel } from '../lib/authority';
import { useWorkspace } from '../stores/workspace';

interface Props {
  file: MergedFileRecord;
}

type ScoreKey = 'validity' | 'clarity' | 'completeness' | 'stability';

const DIMENSIONS: { key: ScoreKey; label: string; description: string }[] = [
  { key: 'validity', label: 'Validity', description: 'Does this match reality? (code, tests, evidence)' },
  { key: 'clarity', label: 'Clarity', description: 'Can humans and agents parse the intent?' },
  { key: 'completeness', label: 'Completeness', description: 'How much work is done vs needed?' },
  { key: 'stability', label: 'Stability', description: 'How settled is the design?' },
];

const SCORE_LEVEL_DESCRIPTIONS: Record<ScoreKey, Record<number, string>> = {
  validity: {
    1: 'Likely wrong, stale, or unsupported by evidence.',
    2: 'Questionable; needs verification against code, tests, or reality.',
    3: 'Mostly matches reality, with known caveats.',
    4: 'Verified for normal cases and safe to rely on.',
    5: 'Strongly evidenced and aligned with code, tests, and docs.',
  },
  clarity: {
    1: 'Hard to understand without outside explanation.',
    2: 'Understandable only with guessing or local context.',
    3: 'Understandable with some context.',
    4: 'Clear to humans and agents.',
    5: 'Crystal clear; very low ambiguity.',
  },
  completeness: {
    1: 'Seed or stub only.',
    2: 'Partial; important gaps remain.',
    3: 'Usable core with known gaps.',
    4: 'Mostly complete for the current scope.',
    5: 'Complete for the current scope.',
  },
  stability: {
    1: 'Volatile or experimental.',
    2: 'Likely to change soon.',
    3: 'Settled enough for now.',
    4: 'Stable; changes should be deliberate.',
    5: 'Very stable; rare changes expected.',
  },
};

export function scoreButtonTitle(key: ScoreKey, label: string, value: number): string {
  return `${label} ${value}/5: ${SCORE_LEVEL_DESCRIPTIONS[key][value]}`;
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full
          border border-border text-[10px] text-text-muted transition-colors
          hover:border-accent hover:text-text-primary focus:border-accent
          focus:text-text-primary focus:outline-none"
        title={text}
        aria-label={`Info: ${text}`}
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-5 z-30 hidden w-64 rounded-lg
          border border-border bg-canvas p-2 text-left text-xs leading-5 text-text-secondary
          shadow-xl group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

function ScoreRow({
  scoreKey,
  label,
  description,
  value,
  onSet,
}: {
  scoreKey: ScoreKey;
  label: string;
  description: string;
  value: number | undefined;
  onSet: (v: number) => void;
}) {
  const current = value ?? 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-forest-300 w-32 text-right shrink-0 flex items-center justify-end gap-1">
        {label}
        <InfoTip text={description} />
      </span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(v => (
          <button
            key={v}
            onClick={() => onSet(v === current ? 0 : v)}
            className={`w-7 h-4 rounded-sm transition-colors ${
              v <= current
                ? 'bg-accent'
                : 'bg-surface border border-border hover:border-accent'
            }`}
            title={scoreButtonTitle(scoreKey, label, v)}
            aria-label={scoreButtonTitle(scoreKey, label, v)}
          />
        ))}
      </div>
      <span className="text-forest-400 w-8">
        {current > 0 ? `${current}/5` : '-'}
      </span>
    </div>
  );
}

function AuthorityRow({
  value,
  onSet,
}: {
  value: AuthorityLevel | undefined;
  onSet: (v: AuthorityLevel) => void;
}) {
  const currentLevel = AUTHORITY_LEVELS.find(a => a.value === value);
  const currentNumber = currentLevel?.number ?? 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-forest-300 w-32 text-right shrink-0 flex items-center justify-end gap-1">
        Authority
        <InfoTip text={AUTHORITY_HELP_TEXT} />
      </span>
      <div className="flex items-center gap-1">
        {AUTHORITY_LEVELS.map(level => (
          <button
            key={level.value}
            onClick={() => onSet(level.value)}
            title={`${level.number} - ${level.label} (${level.canonicalLabel}): ${level.description}`}
            className={`w-7 h-4 rounded-sm transition-colors ${
              level.number <= currentNumber
                ? 'bg-accent'
                : 'bg-surface border border-border hover:border-accent'
            }`}
            aria-label={`${level.number} - ${level.label}`}
          />
        ))}
      </div>
      <span className="text-forest-400 w-24">
        {formatAuthorityLabel(currentLevel?.value)}
      </span>
    </div>
  );
}

function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function authorLabel(author?: Author): string | null {
  if (!author) return null;
  const signature = normalizeAuthor(author);
  return signature.name ?? signature.role;
}

function freshnessTone(status: FreshnessStatus): string {
  switch (status) {
    case 'review-drift':
      return 'border-amber-700/50 bg-amber-950/40 text-amber-300';
    case 'fresh':
      return 'border-forest-800 bg-forest-950/50 text-forest-300';
    default:
      return 'border-border bg-surface text-text-muted';
  }
}

function freshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case 'review-drift':
      return 'Review Drift';
    case 'fresh':
      return 'Fresh';
    default:
      return 'Unknown';
  }
}

export function AuthorityBar({ file }: Props) {
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);

  const handleAuthority = async (value: AuthorityLevel) => {
    const newValue = value === file.authorityLevel ? undefined : value;
    await api.updateFileMeta(file.path, { authorityLevel: newValue as string });
    await refreshSelectedFile();
  };

  return (
    <AuthorityRow value={file.authorityLevel} onSet={handleAuthority} />
  );
}

export function FileDates({ file }: Props) {
  const index = useWorkspace(s => s.index);

  if (!file.lastModified && !file.lastReviewed) return null;
  const relatedModifiedDates = file.relatedFiles
    .filter(relation => (relation.closeness ?? 3) >= 4)
    .map(relation => index.find(candidate => candidate.path === relation.path)?.lastModified)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const freshness = checkFreshness({
    lastModified: file.lastModified,
    lastReviewed: file.lastReviewed,
    relatedModifiedDates,
  });
  const reviewer = authorLabel(file.lastReviewedBy);

  return (
    <div className="flex flex-col items-end gap-1 text-sm text-text-secondary">
      {freshness && (
        <span
          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${freshnessTone(freshness)}`}
          title={freshness === 'review-drift'
            ? 'This file or closely related files changed after the last review.'
            : freshness === 'fresh'
              ? 'No review drift detected since the last review.'
              : 'This file has no recorded review date yet.'}
        >
          {freshnessLabel(freshness)}
        </span>
      )}
      <div className="flex items-center gap-4">
        {file.lastModified && (
          <span title="Last git commit date">
            Modified {formatRelativeDate(file.lastModified)}
          </span>
        )}
        {file.lastReviewed && (
          <span
            className={freshness === 'review-drift' ? 'text-warning' : ''}
            title={reviewer ? `When annotations were last reviewed by ${reviewer}` : 'When annotations were last reviewed'}
          >
            Reviewed {formatRelativeDate(file.lastReviewed)}{reviewer ? ` by ${reviewer}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export function ScoreDisplay({ file }: Props) {
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);

  const handleScore = async (key: ScoreKey, value: number) => {
    await api.updateFileMeta(file.path, { [key]: value === 0 ? null : value });
    await refreshSelectedFile();
  };

  const handleAuthority = async (value: AuthorityLevel) => {
    const newValue = value === file.authorityLevel ? undefined : value;
    await api.updateFileMeta(file.path, { authorityLevel: newValue as string });
    await refreshSelectedFile();
  };

  const handleReviewToggle = async () => {
    await api.updateFileMeta(file.path, { scoresReviewed: !file.scoresReviewed });
    await refreshSelectedFile();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-text-primary text-sm uppercase tracking-wider">
          Scores
        </label>
        <button
          onClick={handleReviewToggle}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            file.scoresReviewed
              ? 'bg-accent text-on-accent border border-accent'
              : 'bg-surface text-text-muted border border-border hover:border-accent'
          }`}
          title={file.scoresReviewed ? 'Scores reviewed by human' : 'Scores not yet reviewed — click to mark as reviewed'}
        >
          {file.scoresReviewed ? 'Reviewed' : 'Unreviewed'}
        </button>
      </div>
      <div className="space-y-2">
        <AuthorityRow value={file.authorityLevel} onSet={handleAuthority} />
        <div className="border-t border-border my-1" />
        {DIMENSIONS.map(d => (
          <ScoreRow
            key={d.key}
            scoreKey={d.key}
            label={d.label}
            description={d.description}
            value={file[d.key]}
            onSet={(v) => handleScore(d.key, v)}
          />
        ))}
      </div>
    </div>
  );
}
