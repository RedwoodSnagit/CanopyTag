#!/usr/bin/env node
/**
 * canopytag analytics — inspect agent activity heatmap
 *
 * Usage:
 *   canopytag analytics                   # last 7 days, top 10 files
 *   canopytag analytics --days 30         # last 30 days
 *   canopytag analytics --limit 20        # top 20 files
 *   canopytag analytics clear             # wipe all analytics data
 *   canopytag analytics clear --before 2026-03-01   # prune before date
 */

import { parseArgs } from 'node:util';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  resolveAnalyticsPath, readAnalytics, writeAnalytics,
  emptyAnalytics, engagementScore, windowedTotals,
} from '../backend/lib/analytics.js';
import { resolveRepoRoot } from './shared.js';
import type { CanopyAnalytics, FileAnalytics } from '../shared/types.js';

// ---- Rendering helpers ----

function bar(score: number, max: number, width = 8): string {
  if (max === 0) return ' '.repeat(width);
  const filled = Math.round((score / max) * width);
  return '█'.repeat(filled) + ' '.repeat(width - filled);
}

function breakdownLabel(totals: ReturnType<typeof windowedTotals>): string {
  const parts: string[] = [];
  if (totals.readCount > 0) parts.push(`${totals.readCount}r`);
  if (totals.editCount > 0) parts.push(`${totals.editCount}e`);
  if (totals.writeCount > 0) parts.push(`${totals.writeCount}w`);
  if (totals.canopyQueryCount > 0) parts.push(`${totals.canopyQueryCount}q`);
  if ((totals.grepHitCount ?? 0) > 0) parts.push(`${totals.grepHitCount}grep`);
  if ((totals.globHitCount ?? 0) > 0) parts.push(`${totals.globHitCount}glob`);
  if ((totals.ripgrepHitCount ?? 0) > 0) parts.push(`${totals.ripgrepHitCount}rg`);
  return parts.length > 0 ? `(${parts.join(' ')})` : '';
}

// ---- Build output ----

export function buildAnalytics(analytics: CanopyAnalytics, windowDays: number, limit: number): string {
  const lines: string[] = [];

  const sinceLabel = analytics.clearedBefore ? `  (since ${analytics.clearedBefore})` : '';
  lines.push(`agent activity: last ${windowDays} days${sinceLabel}`);
  lines.push('');

  // Hot files
  const scoredFiles = Object.entries(analytics.files)
    .map(([filePath, fa]) => ({
      filePath,
      score: engagementScore(fa, windowDays),
      totals: windowedTotals(fa, windowDays),
    }))
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scoredFiles.length === 0) {
    lines.push('  no activity recorded yet');
    lines.push('  (install the hook with: canopytag hook install)');
  } else {
    lines.push('  hot files (by engagement)');
    const maxScore = scoredFiles[0].score;
    const maxPathLen = Math.min(40, Math.max(...scoredFiles.map(f => f.filePath.length)));
    for (const { filePath, score, totals } of scoredFiles) {
      const truncPath = filePath.length > maxPathLen
        ? '…' + filePath.slice(-(maxPathLen - 1))
        : filePath;
      const padded = truncPath.padEnd(maxPathLen);
      const breakdown = breakdownLabel(totals);
      lines.push(`    ${padded}  ${bar(score, maxScore)}  ${String(score).padStart(3)}  ${breakdown}`);
    }
  }

  lines.push('');

  // Navigation trend — last 7 days (always 7-day window for the trend)
  const trendDays = Math.min(windowDays, 7);
  const dayKeys: string[] = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const hasTrendData = dayKeys.some(d => analytics.daily[d]);
  if (hasTrendData) {
    lines.push('  navigation trend');
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxGrep = Math.max(1, ...dayKeys.map(d => analytics.daily[d]?.grepCount ?? 0));
    const maxGlob = Math.max(1, ...dayKeys.map(d => analytics.daily[d]?.globCount ?? 0));
    const maxRipgrep = Math.max(1, ...dayKeys.map(d => analytics.daily[d]?.ripgrepCount ?? 0));
    for (const dayKey of dayKeys) {
      const day = analytics.daily[dayKey];
      const dayName = DAY_NAMES[new Date(dayKey + 'T12:00:00').getDay()];
      const grep = day?.grepCount ?? 0;
      const glob = day?.globCount ?? 0;
      const ripgrep = day?.ripgrepCount ?? 0;
      lines.push(
        `    ${dayName}  grep ${bar(grep, maxGrep)} ${String(grep).padStart(3)}` +
        `  glob ${bar(glob, maxGlob, 4)} ${String(glob).padStart(3)}` +
        `  rg ${bar(ripgrep, maxRipgrep, 4)} ${String(ripgrep).padStart(3)}`
      );
    }
    lines.push('');
  }

  // Today
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayData = analytics.daily[todayKey];
  lines.push('  today');
  lines.push(`    grep: ${todayData?.grepCount ?? 0}   glob: ${todayData?.globCount ?? 0}   rg: ${todayData?.ripgrepCount ?? 0}   files touched: ${todayData?.uniqueFilesAccessed ?? 0}`);

  return lines.join('\n');
}

// ---- Clear subcommand ----

async function runClear(analyticsPath: string, beforeDate: string | undefined): Promise<void> {
  if (!beforeDate) {
    // Full wipe — prompt for confirmation
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question('Wipe all analytics data? This cannot be undone. (yes/no): ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      return;
    }
    writeAnalytics(analyticsPath, emptyAnalytics());
    console.log('Analytics data cleared.');
    return;
  }

  // Prune entries older than beforeDate
  const analytics = readAnalytics(analyticsPath);

  for (const fa of Object.values(analytics.files)) {
    for (const date of Object.keys(fa.days)) {
      if (date < beforeDate) delete fa.days[date];
    }
    // Recalculate total from remaining days
    fa.total = {
      readCount: 0,
      editCount: 0,
      writeCount: 0,
      canopyQueryCount: 0,
      grepHitCount: 0,
      globHitCount: 0,
      ripgrepHitCount: 0,
    };
    for (const bucket of Object.values(fa.days)) {
      fa.total.readCount += bucket.readCount ?? 0;
      fa.total.editCount += bucket.editCount ?? 0;
      fa.total.writeCount += bucket.writeCount ?? 0;
      fa.total.canopyQueryCount += bucket.canopyQueryCount ?? 0;
      fa.total.grepHitCount = (fa.total.grepHitCount ?? 0) + (bucket.grepHitCount ?? 0);
      fa.total.globHitCount = (fa.total.globHitCount ?? 0) + (bucket.globHitCount ?? 0);
      fa.total.ripgrepHitCount = (fa.total.ripgrepHitCount ?? 0) + (bucket.ripgrepHitCount ?? 0);
    }
  }

  for (const date of Object.keys(analytics.daily)) {
    if (date < beforeDate) delete analytics.daily[date];
  }

  analytics.clearedBefore = beforeDate;
  writeAnalytics(analyticsPath, analytics);
  console.log(`Analytics data pruned before ${beforeDate}.`);
}

// ---- Entry point ----

function run() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (subcommand === 'clear') {
    const { values } = parseArgs({
      args: args.slice(1),
      options: { before: { type: 'string' } },
      strict: false,
    });
    const analyticsPath = resolveAnalyticsPath();
    runClear(analyticsPath, values.before as string | undefined).catch(console.error);
    return;
  }

  const { values } = parseArgs({
    args,
    options: {
      days: { type: 'string' },
      limit: { type: 'string' },
      repo: { type: 'string', short: 'r' },
    },
    strict: false,
  });

  const windowDays = Math.max(1, parseInt(values.days as string ?? '7', 10) || 7);
  const limit = Math.max(1, parseInt(values.limit as string ?? '10', 10) || 10);
  const repoRoot = values.repo as string | undefined;

  const analyticsPath = resolveAnalyticsPath(repoRoot);
  const analytics = readAnalytics(analyticsPath);
  console.log(buildAnalytics(analytics, windowDays, limit));
}

const isDirectRun = process.argv[1]?.endsWith('analytics.ts') || process.argv[1]?.endsWith('analytics.js');
if (isDirectRun) run();
