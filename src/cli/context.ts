#!/usr/bin/env node
/**
 * canopytag context — compact context block for agent prompt injection
 *
 * Usage:
 *   canopytag context src/cli/health.ts          # context for a single file
 *   canopytag context --feature cli-tools         # context for a feature
 *   canopytag context --feature cli-tools --depth 3  # include connections at depth
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import { trackCanopyQueries } from '../backend/lib/analytics.js';
import { normalizeAuthor, normalizeRelation } from '../shared/types.js';
import type {
  Author, Canopy, Feature, FileCanopy, AuthorityLevel, RelationType, FileRelation,
} from '../shared/types.js';
import {
  resolveCanopyPath, resolveRepoRoot, truncate, authorityScore,
  CORE_OPTIONS,
  filterFiles, isSurprising, fetchGitDates, collectFreshnessPaths, getFreshnessStatus, freshnessLabel,
} from './shared.js';

// ---- Per-dimension expected minimums by authority level ----
// A spec with completeness=2 is a warning. A guideline with completeness=2 is fine.

const DIMENSION_MINIMUMS: Record<AuthorityLevel, number> = {
  idea:          0,
  blueprint:     1,
  guideline:     2,
  specification: 3,
  standard:      4,
};

const DIMENSION_NAMES = ['validity', 'clarity', 'completeness', 'stability'] as const;
type DimensionName = typeof DIMENSION_NAMES[number];

export interface DimensionWarning {
  dimension: DimensionName;
  score: number;
  minimum: number;
}

export function getDimensionWarnings(fc: FileCanopy): DimensionWarning[] {
  if (!fc.authorityLevel) return [];
  const min = DIMENSION_MINIMUMS[fc.authorityLevel];
  if (min === 0) return [];  // ideas get no warnings

  const warnings: DimensionWarning[] = [];
  for (const dim of DIMENSION_NAMES) {
    const score = fc[dim];
    if (score != null && score < min) {
      warnings.push({ dimension: dim, score, minimum: min });
    }
  }
  return warnings;
}

// ---- Context block rendering ----

function authLabel(level?: AuthorityLevel): string {
  if (!level) return 'unclassified';
  return level;
}

function authorLabel(author: Author): string {
  const signature = normalizeAuthor(author);
  return signature.name ? `${signature.role}:${signature.name}` : signature.role;
}

function renderFeatureCard(feature: Feature): string[] {
  const lines: string[] = [];
  const meta = [
    feature.status ? `status: ${feature.status}` : undefined,
    feature.promotionStatus ? `promotion: ${feature.promotionStatus}` : undefined,
  ].filter((value): value is string => Boolean(value));

  if (meta.length > 0) {
    lines.push(`Feature: ${meta.join(', ')}`);
  }
  if (feature.canonicalFile) {
    lines.push(`Start: ${feature.canonicalFile}`);
  }
  if (feature.owners?.length) {
    lines.push(`Owners: ${feature.owners.map(authorLabel).join(', ')}`);
  }
  if (feature.tags?.length) {
    lines.push(`Tags: ${feature.tags.join(', ')}`);
  }
  if (feature.openQuestions?.length) {
    lines.push('Open questions:');
    for (const question of feature.openQuestions) {
      lines.push(`- ${question}`);
    }
  }

  return lines;
}

function renderFileContext(
  filePath: string,
  fc: FileCanopy,
  canopy: Canopy,
  depth: number,
  gitDates?: Map<string, string>,
): string[] {
  const lines: string[] = [];
  const auth = authLabel(fc.authorityLevel);
  const status = fc.status ?? 'active';
  const review = freshnessLabel(getFreshnessStatus(filePath, fc, gitDates));

  // Header
  lines.push(`${filePath} — ${auth} (${status})`);

  // Summary
  if (fc.summary) {
    lines.push(`  ${fc.summary}`);
  }
  lines.push(`  Review: ${review}`);

  // Dimension warnings
  const warnings = getDimensionWarnings(fc);
  if (warnings.length > 0) {
    for (const w of warnings) {
      lines.push(`  ⚠ ${w.dimension}: ${w.score}/5 — below ${w.minimum} expected for ${fc.authorityLevel}`);
    }
  }

  // Unreviewed scores flag
  if (fc.scoresReviewed === false && fc.authorityLevel) {
    const scores = [fc.validity, fc.clarity, fc.completeness, fc.stability];
    const hasScores = scores.some(s => s != null);
    if (hasScores) {
      lines.push(`  ⚠ scores not human-reviewed`);
    }
  }

  // Findings (finding-type comments — surfaces surprises prominently)
  const findings = (fc.comments ?? []).filter(c => c.type === 'finding');
  if (findings.length > 0) {
    for (const f of findings) {
      const conf = f.confidence ? ` (confidence: ${f.confidence}/5)` : '';
      lines.push(`  !! ${f.text}${conf}`);
    }
  }

  // Open TODOs
  const openTodos = (fc.todos ?? []).filter(t => t.status === 'open' || t.status === 'in_progress');
  if (openTodos.length > 0) {
    const todoLine = openTodos
      .sort((a, b) => a.priority - b.priority)
      .map(t => `${t.id}(P${t.priority}): ${truncate(t.text, 50)}`)
      .join('; ');
    lines.push(`  TODOs: ${todoLine}`);
  }

  // Relations (at requested depth)
  const relations = (fc.relatedFiles ?? []).map(normalizeRelation);
  const minCloseness = depth;
  const filtered = relations
    .filter(r => (r.closeness ?? 3) >= minCloseness)
    .sort((a, b) => (b.closeness ?? 3) - (a.closeness ?? 3));

  if (filtered.length > 0) {
    const relParts = filtered.map(r => {
      const relType = r.relation ? `[${r.relation}] ` : '';
      return `${relType}${r.path} (${r.closeness ?? 3}/5)`;
    });
    lines.push(`  Relations: ${relParts.join(', ')}`);
  }

  // Tags
  if (fc.tags?.length) {
    lines.push(`  Tags: ${fc.tags.join(', ')}`);
  }

  return lines;
}

export interface ContextOptions {
  file?: string;
  files?: string[];   // multiple file lookup (e.g. after grep)
  feature?: string;
  depth?: number;
  surprising?: boolean;  // filter to files tagged 'surprising' or with finding comments
  repoRoot?: string;
  gitDates?: Map<string, string>;
}

export function buildContext(canopy: Canopy, opts: ContextOptions): string {
  const depth = opts.depth ?? 4;  // default: tight connections
  const lines: string[] = [];

  const resolveGitDates = (entries: [string, FileCanopy][]): Map<string, string> | undefined => {
    if (opts.gitDates) return opts.gitDates;
    if (!opts.repoRoot) return undefined;
    const paths = collectFreshnessPaths(entries);
    if (paths.length === 0) return undefined;
    return fetchGitDates(opts.repoRoot, paths);
  };

  // Multi-file mode: agent passes several paths from grep results
  if (opts.files && opts.files.length > 0) {
    let found = 0;
    let notFound = 0;
    const annotatedEntries = opts.files
      .map((filePath): [string, FileCanopy | undefined] => [filePath, canopy.files[filePath]])
      .filter((entry): entry is [string, FileCanopy] => entry[1] != null);
    const gitDates = resolveGitDates(annotatedEntries);
    for (const filePath of opts.files) {
      const fc = canopy.files[filePath];
      if (fc) {
        lines.push(...renderFileContext(filePath, fc, canopy, depth, gitDates));
        lines.push('');
        found++;
      } else {
        lines.push(`${filePath} — not annotated`);
        lines.push('');
        notFound++;
      }
    }
    if (notFound > 0) {
      lines.push(`${found} annotated, ${notFound} not annotated out of ${opts.files.length} files`);
    }
    return lines.join('\n');
  }

  if (opts.file) {
    // Single file mode
    const fc = canopy.files[opts.file];
    if (!fc) {
      return `No annotation found for: ${opts.file}`;
    }
    const gitDates = resolveGitDates([[opts.file, fc]]);
    lines.push(...renderFileContext(opts.file, fc, canopy, depth, gitDates));
    return lines.join('\n');
  }

  if (opts.feature) {
    // Feature mode — feature summary + all files in feature
    const featId = opts.feature.toLowerCase();
    const feature = canopy.features[featId] ?? canopy.features[opts.feature];

    if (feature) {
      lines.push(`# ${feature.name ?? opts.feature}`);
      if (feature.description) {
        lines.push(feature.description);
      }
      lines.push(...renderFeatureCard(feature));
      lines.push('');
    } else {
      lines.push(`# ${opts.feature}`);
      lines.push('');
    }

    // Collect files in this feature
    const featureFiles = filterFiles(Object.entries(canopy.files), {
      feature: featId,
      ...(opts.surprising ? { surprising: true } : {}),
    });

    if (featureFiles.length === 0) {
      lines.push('No annotated files in this feature.');
      return lines.join('\n');
    }
    const gitDates = resolveGitDates(featureFiles);

    // Sort by authority (highest first)
    featureFiles.sort((a, b) => authorityScore(b[1]) - authorityScore(a[1]));

    // Aggregate dimension stats across the feature
    const dimTotals: Record<DimensionName, { sum: number; count: number }> = {
      validity:     { sum: 0, count: 0 },
      clarity:      { sum: 0, count: 0 },
      completeness: { sum: 0, count: 0 },
      stability:    { sum: 0, count: 0 },
    };
    let unreviewedCount = 0;
    let totalWarnings = 0;

    for (const [, fc] of featureFiles) {
      for (const dim of DIMENSION_NAMES) {
        const score = fc[dim];
        if (score != null) {
          dimTotals[dim].sum += score;
          dimTotals[dim].count++;
        }
      }
      if (fc.scoresReviewed === false) unreviewedCount++;
      totalWarnings += getDimensionWarnings(fc).length;
    }

    // Feature-level dimension summary
    const dimSummaryParts: string[] = [];
    let weakest: { dim: DimensionName; avg: number } | null = null;
    for (const dim of DIMENSION_NAMES) {
      const { sum, count } = dimTotals[dim];
      if (count > 0) {
        const avg = sum / count;
        dimSummaryParts.push(`${dim}: ${avg.toFixed(1)}`);
        if (!weakest || avg < weakest.avg) {
          weakest = { dim, avg };
        }
      }
    }
    if (dimSummaryParts.length > 0) {
      lines.push(`Avg scores: ${dimSummaryParts.join(', ')}`);
    }
    if (weakest && dimSummaryParts.length > 1) {
      lines.push(`Weakest dimension: ${weakest.dim} (${weakest.avg.toFixed(1)})`);
    }
    if (unreviewedCount > 0) {
      lines.push(`⚠ ${unreviewedCount}/${featureFiles.length} files have unreviewed scores`);
    }
    if (totalWarnings > 0) {
      lines.push(`⚠ ${totalWarnings} dimension warning${totalWarnings !== 1 ? 's' : ''} across ${featureFiles.length} files`);
    }
    lines.push('');

    // Render each file
    for (const [filePath, fc] of featureFiles) {
      lines.push(...renderFileContext(filePath, fc, canopy, depth, gitDates));
      lines.push('');
    }

    // Collect all open TODOs across the feature
    const allTodos: { file: string; id: string; priority: number; text: string }[] = [];
    for (const [filePath, fc] of featureFiles) {
      for (const todo of (fc.todos ?? [])) {
        if (todo.status === 'open' || todo.status === 'in_progress') {
          allTodos.push({ file: filePath, id: todo.id, priority: todo.priority, text: todo.text });
        }
      }
    }
    if (allTodos.length > 0) {
      allTodos.sort((a, b) => a.priority - b.priority);
      lines.push('Open TODOs:');
      for (const t of allTodos) {
        lines.push(`  ${t.id} P${t.priority}  ${truncate(t.text, 60)}`);
      }
    }

    return lines.join('\n');
  }

  return 'Usage: canopytag context <file> or canopytag context --feature <name>';
}

function run() {
  const { values, positionals } = parseArgs({
    options: {
      ...CORE_OPTIONS,
      feature:    { type: 'string', short: 'f' },
      depth:      { type: 'string', short: 'd' },
      surprising: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag context — compact context block for prompt injection

Usage:
  canopytag context <file>                    # single file context
  canopytag context <file1> <file2> ...       # multi-file lookup (after grep)
  canopytag context --feature <name>          # feature context (all files)
  canopytag context <file> --depth 3          # include wider relations

Surfaces: summary, dimension warnings, open TODOs, relations, tags.
Dimension warnings flag scores below expected minimums for the file's
authority level (e.g. completeness=2 on a specification).
Unannotated files are reported as "not annotated" rather than silently skipped.

Options:
  -r, --repo <path>        Repo root (default: cwd)
  -f, --feature <name>     Feature ID to summarize
  -d, --depth <1-5>        Relation closeness threshold (default: 4)
      --surprising         Only files tagged 'surprising' or with finding comments
  -h, --help               Show this help`);
    return;
  }

  const repoRoot = resolveRepoRoot(values.repo as string | undefined);
  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const canopy = readCanopy(canopyPath);

  const feature = values.feature as string | undefined;
  const depth = parseInt(values.depth as string, 10) || undefined;
  const surprising = (values.surprising as boolean | undefined) ?? false;

  if (positionals.length === 0 && !feature) {
    console.error('Usage: canopytag context <file> [<file2> ...] or canopytag context --feature <name>');
    process.exit(1);
  }

  let output: string;
  if (positionals.length > 1) {
    output = buildContext(canopy, { files: positionals, depth, surprising, repoRoot });
  } else if (positionals.length === 1) {
    output = buildContext(canopy, { file: positionals[0], feature, depth, surprising, repoRoot });
  } else {
    output = buildContext(canopy, { feature, depth, surprising, repoRoot });
  }

  if (positionals.length > 0) {
    trackCanopyQueries(values.repo as string | undefined, positionals);
  }

  console.log(output);
}

// Guard: don't run when imported as a module (e.g. in tests)
const isDirectRun = process.argv[1]?.endsWith('context.ts');
if (isDirectRun) run();
