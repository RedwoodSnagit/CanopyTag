// ---- Canopy schema (snake_case on disk, camelCase in TS) ----
// Note: Enum string VALUES (like 'in_progress') intentionally match the on-disk
// format. Only object KEYS are transformed by case-transform. Enum values are
// stable data, not structural keys.

export type Priority = 1 | 2 | 3 | 4 | 5;
export type TodoStatus = 'open' | 'in_progress' | 'done' | 'deferred';
export type FileStatus = 'active' | 'draft' | 'deprecated' | 'experimental' | 'superseded' | 'archived';
export type AuthorityLevel = 'idea' | 'blueprint' | 'guideline' | 'specification' | 'standard';
export type AuthorRole = 'human' | 'agent';
export type CommentType = 'finding' | 'bug' | 'improvement' | 'note';
export type Confidence = 1 | 2 | 3 | 4 | 5;
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type ArchiveRetention = 'off' | '1d' | '7d' | '30d';

// ---- Relationship types for file connections ----
// Used in relatedFiles to express HOW files are connected, not just THAT they are.
// Enables filtered traversal: "show me implementations" vs "show me docs"

export type RelationType =
  | 'doc-for'        // documentation of
  | 'test-of'        // validates/tests
  | 'implements'     // code that realizes a spec
  | 'procedure-for'  // checklist, improvement plan, workflow
  | 'audit-of'       // review, findings
  | 'update-on'      // progress log, changelog (transient)
  | 'fed-by';        // data dependency / pipeline input

export type Closeness = 1 | 2 | 3 | 4 | 5;
// 5 = can't understand this file without that one (spec ↔ implementation)
// 4 = you should read this (test, direct dependency)
// 3 = useful context (sibling in same feature)
// 2 = loosely related (same subsystem, different feature)
// 1 = neighborhood (same directory, tagged similarly)

export interface FileRelation {
  path: string;
  closeness?: Closeness;       // default 3 if omitted
  relation?: RelationType;     // default untyped if omitted
}

// Backward compat: accept bare strings or rich objects
export type RelatedFileEntry = string | FileRelation;

// Normalize any entry to a FileRelation
export function normalizeRelation(entry: RelatedFileEntry): FileRelation {
  if (typeof entry === 'string') {
    return { path: entry };
  }
  return entry;
}

// Structured author signature — supports both legacy string and rich format
// Legacy: "human" | "agent" (backward compatible)
// Rich: { role: "human", name: "jeff" } or { role: "agent", name: "claude-opus", session: "..." }
export interface AuthorSignature {
  role: AuthorRole;
  name?: string;       // e.g. "jeff", "claude-opus", "cursor"
  session?: string;    // optional session/run identifier
}

// Accept both legacy string and structured signature
export type Author = AuthorRole | AuthorSignature;

// Helper to normalize legacy string authors to structured format
export function normalizeAuthor(author: Author): AuthorSignature {
  if (typeof author === 'string') {
    return { role: author };
  }
  return author;
}

export interface CanopyProfile {
  version: number;
  currentAuthor: AuthorSignature;
}

export interface Todo {
  id: string;
  text: string;
  priority: Priority;
  difficulty?: Difficulty;
  status: TodoStatus;
  tags?: string[];
  createdAt: string;             // ISO-8601 UTC
  completedAt?: string;          // ISO-8601 UTC, set when status → done
  createdBy: Author;
}

export interface Comment {
  id?: string;                   // Optional for backward compat with legacy data
  text: string;
  author: Author;
  createdAt: string;             // ISO-8601 UTC
  type?: CommentType;
  confidence?: Confidence;
}

export interface IoMetadata {
  inputs?: string[];       // What this script/module takes: [".fit file path", "rider config JSON"]
  outputs?: string[];      // What it produces: ["simulation results JSON", "power curve plot"]
}

export interface FileCanopy {
  title?: string;      // Human-readable name, e.g. "Project playbook" for AGENT.md
  summary?: string;
  ioMetadata?: IoMetadata;  // Optional — for entrypoints and scripts with clear I/O contracts
  // Quality dimensions (1-5 scale, editable)
  validity?: number;
  clarity?: number;
  completeness?: number;
  stability?: number;
  // Scores review flag — false means agent-scored, pending human review
  scoresReviewed?: boolean;
  // ISO date — when someone last reviewed this file's annotations for accuracy
  lastReviewed?: string;
  lastReviewedBy?: Author;
  tags?: string[];
  featureId?: string;
  authorityLevel?: AuthorityLevel;
  status?: FileStatus;
  todos?: Todo[];
  comments?: Comment[];
  relatedFiles?: RelatedFileEntry[];
  locked?: boolean;  // When true, MCP write tools refuse metadata changes. Comments always allowed.
}

// ---- Authority health check ----
// Compares declared authority against quality sub-scores.
// Mismatch is the interesting signal — not the score itself.

export interface AuthorityHealth {
  authorityLevel: AuthorityLevel;
  expectedRange: [number, number];  // min/max aggregate for this authority
  aggregate: number;                // sum of validity + clarity + completeness + stability (0-20)
  status: 'healthy' | 'underscored' | 'promotion-candidate' | 'unscored';
}

const AUTHORITY_EXPECTED: Record<AuthorityLevel, [number, number]> = {
  idea:          [0, 8],
  blueprint:     [5, 12],
  guideline:     [8, 16],
  specification: [12, 20],
  standard:      [16, 20],
};

function isAuthorityLevel(value: string): value is AuthorityLevel {
  return value in AUTHORITY_EXPECTED;
}

export function checkAuthorityHealth(fc: FileCanopy): AuthorityHealth | null {
  if (!fc.authorityLevel) return null;
  if (!isAuthorityLevel(fc.authorityLevel)) return null;
  const level = fc.authorityLevel;
  const range = AUTHORITY_EXPECTED[level];
  const scores = [fc.validity, fc.clarity, fc.completeness, fc.stability];
  const defined = scores.filter((s): s is number => s != null);
  if (defined.length === 0) {
    return {
      authorityLevel: fc.authorityLevel,
      expectedRange: range,
      aggregate: 0,
      status: 'unscored',
    };
  }
  const aggregate = defined.reduce((a, b) => a + b, 0);
  const [min, max] = range;
  let status: AuthorityHealth['status'];
  if (aggregate < min) {
    status = 'underscored';  // red flag: spec is unclear/unstable
  } else if (aggregate > max && fc.authorityLevel !== 'standard') {
    status = 'promotion-candidate';  // idea scoring like a guideline
  } else {
    status = 'healthy';
  }
  return { authorityLevel: fc.authorityLevel, expectedRange: [min, max], aggregate, status };
}

export type FeaturePromotionStatus = 'seed' | 'emerging' | 'endorsed' | 'retired';

export interface Feature {
  name: string;
  description?: string;
  tags?: string[];
  status?: FileStatus;
  // Feature records are lightweight cards, not duplicate file metadata.
  // Keep detailed truth in files; use these fields to tell agents where to start.
  canonicalFile?: string;
  owners?: Author[];
  openQuestions?: string[];
  promotionStatus?: FeaturePromotionStatus;
}

export interface AgentNote {
  text: string;
  agent: string;         // agent name, e.g. "claude-opus"
  createdAt: string;     // ISO-8601 UTC
  acknowledged?: boolean; // human sets true to dismiss
}

export interface DirectorySummary {
  summary?: string;
}

export interface Canopy {
  version: number;
  repoRoot: string;
  lastModifiedAt: string;
  agentNotes?: AgentNote[];  // top-level handoff messages from agents
  files: Record<string, FileCanopy>;
  directories?: Record<string, DirectorySummary>;  // human-facing context only
  features: Record<string, Feature>;
}

// ---- Settings and archive ----

export interface CanopySettings {
  archiveRetention: ArchiveRetention;
  analyticsEnabled?: boolean;
}

export interface ArchivedItem {
  archivedAt: string;
  filePath: string;
  kind: 'todo' | 'comment';
  item: Todo | Comment;
}

export interface CanopyArchive {
  version: number;
  items: ArchivedItem[];
}

// ---- Analytics types ----

export interface FileAnalyticsTotal {
  readCount: number;
  editCount: number;
  writeCount: number;
  canopyQueryCount: number;
  grepHitCount?: number;
  globHitCount?: number;
  ripgrepHitCount?: number;
}

export interface FileAnalyticsDayBucket {
  readCount?: number;
  editCount?: number;
  writeCount?: number;
  canopyQueryCount?: number;
  grepHitCount?: number;
  globHitCount?: number;
  ripgrepHitCount?: number;
}

export interface FileAnalytics {
  total: FileAnalyticsTotal;
  days: Record<string, FileAnalyticsDayBucket>;  // keyed YYYY-MM-DD
  firstAccessedAt: string;   // ISO-8601 datetime
  lastAccessedAt: string;    // ISO-8601 datetime
}

export interface DailyAnalytics {
  grepCount: number;
  globCount: number;
  ripgrepCount?: number;
  uniqueFilesAccessed: number;
}

export interface CanopyAnalytics {
  version: 1;
  clearedBefore?: string;  // YYYY-MM-DD; present if data has been pruned
  files: Record<string, FileAnalytics>;
  daily: Record<string, DailyAnalytics>;  // keyed YYYY-MM-DD
}

// ---- Repo index types (subset of fields we consume) ----

export interface RepoIndexItem {
  path: string;
  title: string;
  kind: string;
  subsystem: string;
  summary: string;
  authorityLevel?: AuthorityLevel;
  status: FileStatus;
  tags: string[];
  dependsOn?: string[];
  relatedDocs?: string[];
  relatedTests?: string[];
  qualityScore?: number;
  qualityConfidence?: number;
  validity?: number;
  clarity?: number;
  completeness?: number;
  stability?: number;
}

// ---- Merged record (what the UI works with) ----

export interface MergedFileRecord {
  path: string;
  extension: string;
  title?: string;
  kind?: string;
  subsystem?: string;
  summary?: string;
  authorityLevel?: AuthorityLevel;
  status?: FileStatus;
  tags: string[];
  validity?: number;
  clarity?: number;
  completeness?: number;
  stability?: number;
  scoresReviewed?: boolean;
  lastModified?: string;  // ISO date from git, auto-populated
  lastReviewed?: string;  // ISO date from canopy, set on any edit or manual bump
  lastReviewedBy?: Author;
  qualityScore?: number;
  dependsOn?: string[];
  ioMetadata?: IoMetadata;
  featureId?: string;
  todos: Todo[];
  comments: Comment[];
  relatedFiles: FileRelation[];
  openTodoCount: number;
  authorityHealth?: AuthorityHealth;
  highestPriority?: Priority;
}

// Operational freshness states surfaced today in UI/CLI/MCP.
// `Stale` is still a documented/manual concept, but there is not yet a
// persisted override/editor for it, so it is intentionally not emitted here.
export type FreshnessStatus = 'fresh' | 'review-drift' | 'unknown';

interface FreshnessSubject {
  lastModified?: string;
  lastReviewed?: string;
  relatedModifiedDates?: string[];
}

export function checkFreshness(item: FreshnessSubject): FreshnessStatus | null {
  if (!item.lastModified && !item.lastReviewed && !item.relatedModifiedDates?.length) return null;
  if (!item.lastReviewed) return 'unknown';

  const reviewedAt = item.lastReviewed.slice(0, 10);
  const driftDates = [item.lastModified, ...(item.relatedModifiedDates ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(value => value.slice(0, 10));

  return driftDates.some(date => reviewedAt < date) ? 'review-drift' : 'fresh';
}

// ---- Agent manifest sidecar ----
//
// The filename is still `agent_manifest.json`, but operationally this now acts
// as an agent activity / review feed. Agent-authored changes are useful
// immediately in canopy.json; the sidecar exists so humans can later agree,
// fix, or reject specific agent changes without gating the initial write.

export type AgentManifestEntryStatus = 'pending' | 'agreed' | 'fixed' | 'rejected';
export type AgentManifestEntryKind = 'annotate' | 'comment' | 'todo' | 'rename-tag' | 'suggestion';
export type AgentReviewAction = 'agree' | 'fix' | 'reject';
export type SuggestedFreshness = FreshnessStatus | 'stale';

export interface AgentManifestTodoDraft {
  text: string;
  priority?: Priority;
  difficulty?: Difficulty;
  tags?: string[];
}

export interface AgentManifestProposal {
  title?: string;
  summary?: string;
  tags?: string[];
  featureId?: string;
  authorityLevel?: AuthorityLevel;
  fileStatus?: FileStatus;
  validity?: number;
  clarity?: number;
  completeness?: number;
  stability?: number;
  relatedFiles?: RelatedFileEntry[];
}

export interface AgentManifestAnnotateUndo {
  type: 'annotate';
  before: Partial<FileCanopy>;
  after: Partial<FileCanopy>;
}

export interface AgentManifestCommentUndo {
  type: 'comment';
  commentId: string;
  comment: Comment;
}

export interface AgentManifestTodoUndo {
  type: 'todo';
  todoId: string;
  todo: Todo;
}

export interface AgentManifestRenameTagUndo {
  type: 'rename-tag';
  oldTag: string;
  newTag: string;
  files: Array<{
    path: string;
    before?: string[];
    after?: string[];
  }>;
}

export interface AgentManifestSuggestionUndo {
  type: 'suggestion';
}

export type AgentManifestUndo =
  | AgentManifestAnnotateUndo
  | AgentManifestCommentUndo
  | AgentManifestTodoUndo
  | AgentManifestRenameTagUndo
  | AgentManifestSuggestionUndo;

export interface AgentManifestEntry {
  id: string;
  file: string;
  createdAt: string;
  author: Author;
  status: AgentManifestEntryStatus;
  kind?: AgentManifestEntryKind;
  headline?: string;
  fields?: string[];
  applied?: boolean;
  canReject?: boolean;
  reviewedAt?: string;
  reviewer?: Author;
  reviewNote?: string;
  undo?: AgentManifestUndo;
  proposal?: AgentManifestProposal;
  suggestedFreshness?: SuggestedFreshness;
  comment?: string;
  todo?: AgentManifestTodoDraft;
  followUps?: string[];
  rationale?: string;
}

export interface AgentManifest {
  version: number;
  entries: AgentManifestEntry[];
}

// ---- API response types ----

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  children?: TreeNode[];
}

export type ViewMode = 'explorer' | 'table' | 'analytics' | 'graph';

// File kind auto-detection from extension
export type FileKind = 'module' | 'doc' | 'config' | 'test' | 'asset' | 'data' | 'unknown';

export const EXTENSION_KIND_MAP: Record<string, FileKind> = {
  // Modules
  '.py': 'module',
  '.ts': 'module',
  '.tsx': 'module',
  '.js': 'module',
  '.jsx': 'module',
  '.go': 'module',
  '.rs': 'module',
  '.c': 'module',
  '.cpp': 'module',
  '.h': 'module',
  '.hpp': 'module',
  '.java': 'module',
  '.kt': 'module',
  '.swift': 'module',
  '.rb': 'module',
  '.php': 'module',
  '.cs': 'module',
  '.scala': 'module',
  '.lua': 'module',
  '.zig': 'module',
  '.ex': 'module',
  '.exs': 'module',
  '.sh': 'module',
  '.bash': 'module',
  // Docs
  '.md': 'doc',
  '.rst': 'doc',
  '.txt': 'doc',
  '.adoc': 'doc',
  // Config
  '.json': 'config',
  '.yaml': 'config',
  '.yml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.cfg': 'config',
  '.env': 'config',
  // Assets
  '.css': 'asset',
  '.scss': 'asset',
  '.less': 'asset',
  '.html': 'asset',
  '.svg': 'asset',
  '.png': 'asset',
  '.jpg': 'asset',
  '.gif': 'asset',
  '.webp': 'asset',
  '.woff2': 'asset',
  // Data
  '.csv': 'data',
  '.tsv': 'data',
  '.parquet': 'data',
  '.sql': 'data',
};
