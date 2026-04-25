import type {
  AgentManifest,
  AgentManifestEntry,
  AgentManifestEntryStatus,
  RelatedFileEntry,
  SuggestedFreshness,
} from '../../shared/types.js';
import { normalizeRelation } from '../../shared/types.js';

interface ManifestReportOptions {
  file?: string;
  status?: AgentManifestEntryStatus;
  limit?: number;
  all?: boolean;
}

function formatSuggestedFreshness(status: SuggestedFreshness): string {
  switch (status) {
    case 'review-drift':
      return 'Review Drift';
    case 'fresh':
      return 'Fresh';
    case 'unknown':
      return 'Unknown';
    case 'stale':
      return 'Stale';
  }
}

function formatRelatedFiles(entries: RelatedFileEntry[]): string {
  return entries
    .map((entry) => {
      const relation = normalizeRelation(entry);
      const extras: string[] = [];
      if (relation.relation) extras.push(relation.relation);
      if (relation.closeness != null) extras.push(`c${relation.closeness}`);
      return extras.length > 0
        ? `${relation.path} (${extras.join(', ')})`
        : relation.path;
    })
    .join(', ');
}

function matchesOptions(entry: AgentManifestEntry, options: ManifestReportOptions): boolean {
  if (options.file && entry.file !== options.file) return false;
  if (options.status) return entry.status === options.status;
  if (options.all) return true;
  return entry.status === 'pending';
}

function formatKinds(entry: AgentManifestEntry): string {
  const parts: string[] = [];
  if (entry.applied === true) parts.push('applied');
  if (entry.applied === false) parts.push('staged');
  if (entry.kind) parts.push(entry.kind);
  return parts.join(', ');
}

export function buildAgentManifestReport(
  manifest: AgentManifest,
  options: ManifestReportOptions = {},
): string {
  const visible = manifest.entries
    .filter((entry) => matchesOptions(entry, options))
    .sort((a, b) => {
      const byDate = b.createdAt.localeCompare(a.createdAt);
      return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
    });

  const limit = options.limit ?? (options.all || options.status ? visible.length : 20);
  const entries = visible.slice(0, Math.max(limit, 0));

  if (entries.length === 0) {
    if (options.file) {
      return `No manifest entries for ${options.file}.`;
    }
    if (options.status) {
      return `No ${options.status} manifest entries.`;
    }
    if (options.all) {
      return 'No manifest entries.';
    }
    return 'No pending manifest entries.';
  }

  const scope = options.status
    ? `${options.status} manifest entries`
    : options.all
      ? 'Manifest entries'
      : 'Pending manifest entries';

  const lines: string[] = [`${scope}: ${entries.length}`];

  for (const entry of entries) {
    lines.push('');
    lines.push(`${entry.id}  ${entry.status.toUpperCase()}  ${entry.file}`);
    lines.push(`  created: ${entry.createdAt}`);
    if (entry.headline) lines.push(`  headline: ${entry.headline}`);
    if (entry.kind) lines.push(`  kind: ${formatKinds(entry)}`);
    if (entry.fields?.length) lines.push(`  fields: ${entry.fields.join(', ')}`);

    const proposal = entry.proposal;
    if (proposal?.title) lines.push(`  title: ${proposal.title}`);
    if (proposal?.summary) lines.push(`  summary: ${proposal.summary}`);
    if (proposal?.tags?.length) lines.push(`  tags: ${proposal.tags.join(', ')}`);
    if (proposal?.featureId) lines.push(`  feature: ${proposal.featureId}`);
    if (proposal?.authorityLevel) lines.push(`  authority: ${proposal.authorityLevel}`);
    if (proposal?.fileStatus) lines.push(`  file status: ${proposal.fileStatus}`);
    if (proposal?.validity != null) lines.push(`  validity: ${proposal.validity}`);
    if (proposal?.clarity != null) lines.push(`  clarity: ${proposal.clarity}`);
    if (proposal?.completeness != null) lines.push(`  completeness: ${proposal.completeness}`);
    if (proposal?.stability != null) lines.push(`  stability: ${proposal.stability}`);
    if (proposal?.relatedFiles?.length) {
      lines.push(`  related: ${formatRelatedFiles(proposal.relatedFiles)}`);
    }

    if (entry.suggestedFreshness) {
      lines.push(`  suggested freshness: ${formatSuggestedFreshness(entry.suggestedFreshness)}`);
    }
    if (entry.comment) lines.push(`  comment: ${entry.comment}`);
    if (entry.todo) {
      const todoPrefix = entry.todo.priority != null ? `P${entry.todo.priority} ` : '';
      lines.push(`  todo: ${todoPrefix}${entry.todo.text}`);
      if (entry.todo.difficulty != null) lines.push(`  todo difficulty: ${entry.todo.difficulty}`);
      if (entry.todo.tags?.length) lines.push(`  todo tags: ${entry.todo.tags.join(', ')}`);
    }
    if (entry.followUps?.length) {
      lines.push(`  follow-ups: ${entry.followUps.join(', ')}`);
    }
    if (entry.rationale) lines.push(`  rationale: ${entry.rationale}`);
    if (entry.reviewNote) lines.push(`  review note: ${entry.reviewNote}`);
    if (entry.reviewedAt) lines.push(`  reviewed: ${entry.reviewedAt}`);
  }

  if (visible.length > entries.length) {
    lines.push('');
    lines.push(`${visible.length - entries.length} more -- increase limit or pass all=true`);
  }

  return lines.join('\n');
}
