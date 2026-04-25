import path from 'path';
import type { MergedFileRecord, RepoIndexItem, FileCanopy, Priority } from '../../shared/types';
import { EXTENSION_KIND_MAP, normalizeRelation, checkAuthorityHealth } from '../../shared/types';

function detectKind(filePath: string, repoKind?: string): string | undefined {
  if (repoKind) return repoKind;

  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath).toLowerCase();

  // Detect test files by naming convention
  if (baseName.startsWith('test_') || baseName.endsWith('_test.py')
    || baseName.endsWith('.test.ts') || baseName.endsWith('.test.tsx')
    || baseName.endsWith('.spec.ts') || baseName.endsWith('.spec.tsx')) {
    return 'test';
  }

  return EXTENSION_KIND_MAP[ext] ?? 'unknown';
}

export function mergeFileRecord(
  filePath: string,
  repoItem: Partial<RepoIndexItem> | undefined,
  canopy: FileCanopy | undefined,
): MergedFileRecord {
  const todos = canopy?.todos ?? [];
  const openTodos = todos.filter(t => t.status === 'open' || t.status === 'in_progress');
  const priorities = openTodos.map(t => t.priority).filter(Boolean);
  const ext = path.extname(filePath).toLowerCase();

  return {
    path: filePath,
    extension: ext,
    // Canopy wins on shared fields
    title: canopy?.title ?? repoItem?.title,
    kind: detectKind(filePath, repoItem?.kind),
    subsystem: repoItem?.subsystem,
    summary: canopy?.summary ?? repoItem?.summary,
    authorityLevel: canopy?.authorityLevel ?? repoItem?.authorityLevel,
    status: canopy?.status ?? repoItem?.status,
    tags: canopy?.tags ?? repoItem?.tags ?? [],
    // Quality dimensions — canopy wins, repo_index as fallback
    validity: canopy?.validity ?? repoItem?.validity,
    clarity: canopy?.clarity ?? repoItem?.clarity,
    completeness: canopy?.completeness ?? repoItem?.completeness,
    stability: canopy?.stability ?? repoItem?.stability,
    scoresReviewed: canopy?.scoresReviewed,
    lastReviewed: canopy?.lastReviewed,
    lastReviewedBy: canopy?.lastReviewedBy,
    qualityScore: repoItem?.qualityScore,
    dependsOn: repoItem?.dependsOn,
    // Canopy only
    ioMetadata: canopy?.ioMetadata,
    featureId: canopy?.featureId,
    todos,
    comments: canopy?.comments ?? [],
    relatedFiles: (canopy?.relatedFiles ?? []).map(normalizeRelation),
    // Computed
    openTodoCount: openTodos.length,
    highestPriority: priorities.length > 0 ? Math.min(...priorities) as Priority : undefined,
    authorityHealth: canopy ? (checkAuthorityHealth(canopy) ?? undefined) : undefined,
  };
}
