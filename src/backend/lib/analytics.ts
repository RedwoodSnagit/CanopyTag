import fs from 'node:fs';
import path from 'node:path';
import { resolveCanopyPath } from '../../cli/shared.js';
import { parseJsonFile } from './canopy.js';
import type {
  CanopyAnalytics, FileAnalytics, FileAnalyticsTotal,
  FileAnalyticsDayBucket, DailyAnalytics,
} from '../../shared/types.js';

export type AnalyticsField = keyof FileAnalyticsTotal;

// ---- Empty structures ----

export function emptyAnalytics(): CanopyAnalytics {
  return { version: 1, files: {}, daily: {} };
}

function emptyFileAnalytics(now: string): FileAnalytics {
  return {
    total: {
      readCount: 0,
      editCount: 0,
      writeCount: 0,
      canopyQueryCount: 0,
      grepHitCount: 0,
      globHitCount: 0,
      ripgrepHitCount: 0,
    },
    days: {},
    firstAccessedAt: now,
    lastAccessedAt: now,
  };
}

function emptyDailyAnalytics(): DailyAnalytics {
  return { grepCount: 0, globCount: 0, ripgrepCount: 0, uniqueFilesAccessed: 0 };
}

// ---- Path resolution ----

/**
 * Resolves path to .analytics.json.
 * Uses path.dirname(resolveCanopyPath()) to obtain canopyDir —
 * note resolveCanopyPath() returns the full path to canopy.json, not the dir.
 */
export function resolveAnalyticsPath(repoRoot?: string): string {
  const canopyJsonPath = resolveCanopyPath(repoRoot);
  const canopyDir = path.dirname(canopyJsonPath);
  return path.join(canopyDir, '.analytics.json');
}

// ---- IO ----

export function readAnalytics(analyticsPath: string): CanopyAnalytics {
  try {
    if (fs.existsSync(analyticsPath)) {
      return parseJsonFile(analyticsPath) as CanopyAnalytics;
    }
  } catch { /* ignore */ }
  return emptyAnalytics();
}

export function writeAnalytics(analyticsPath: string, analytics: CanopyAnalytics): void {
  const tmp = analyticsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(analytics, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, analyticsPath);
}

// ---- Increment functions ----

/**
 * Increment a per-file counter in both total and today's day bucket.
 * Increments daily.uniqueFilesAccessed on the first direct/file-context event
 * for this file today. Search hits add heat but do not mean the file was opened.
 */
export function incrementFile(
  analytics: CanopyAnalytics,
  filePath: string,
  field: AnalyticsField,
  today: string,
): void {
  const now = new Date().toISOString();

  if (!analytics.files[filePath]) {
    analytics.files[filePath] = emptyFileAnalytics(now);
  }

  const fa = analytics.files[filePath];
  fa.total[field] = (fa.total[field] ?? 0) + 1;
  fa.lastAccessedAt = now;

  if (!fa.days[today]) fa.days[today] = {};
  fa.days[today][field] = (fa.days[today][field] ?? 0) + 1;

  if (field === 'grepHitCount' || field === 'globHitCount' || field === 'ripgrepHitCount') {
    return;
  }

  const dayBucket = fa.days[today];
  const todayTotal =
    (dayBucket.readCount ?? 0) +
    (dayBucket.editCount ?? 0) +
    (dayBucket.writeCount ?? 0) +
    (dayBucket.canopyQueryCount ?? 0);

  if (todayTotal === 1) {
    if (!analytics.daily[today]) analytics.daily[today] = emptyDailyAnalytics();
    analytics.daily[today].uniqueFilesAccessed += 1;
  }
}

/**
 * Increment a daily Grep or Glob counter.
 * Does NOT touch uniqueFilesAccessed — that belongs to incrementFile.
 */
export function incrementDaily(
  analytics: CanopyAnalytics,
  field: 'grepCount' | 'globCount' | 'ripgrepCount',
  today: string,
): void {
  if (!analytics.daily[today]) analytics.daily[today] = emptyDailyAnalytics();
  analytics.daily[today][field] = (analytics.daily[today][field] ?? 0) + 1;
}

export function trackCanopyQueries(repoRoot: string | undefined, filePaths: string[]): void {
  const uniquePaths = [...new Set(filePaths.filter(Boolean))];
  if (uniquePaths.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const analyticsPath = resolveAnalyticsPath(repoRoot);
  const analytics = readAnalytics(analyticsPath);

  for (const filePath of uniquePaths) {
    incrementFile(analytics, filePath, 'canopyQueryCount', today);
  }

  writeAnalytics(analyticsPath, analytics);
}

// ---- Scoring ----

/**
 * Compute engagement score for a file over the last N days.
 * score = readCount + (editCount × 2) + (writeCount × 2) + canopyQueryCount
 */
export function engagementScore(fa: FileAnalytics, windowDays: number): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  let r = 0, e = 0, w = 0, q = 0, g = 0, gl = 0, rg = 0;
  for (const [date, bucket] of Object.entries(fa.days)) {
    if (date >= cutoff) {
      r += bucket.readCount ?? 0;
      e += bucket.editCount ?? 0;
      w += bucket.writeCount ?? 0;
      q += bucket.canopyQueryCount ?? 0;
      g += bucket.grepHitCount ?? 0;
      gl += bucket.globHitCount ?? 0;
      rg += bucket.ripgrepHitCount ?? 0;
    }
  }
  return r + (e * 2) + (w * 2) + q + g + gl + rg;
}

/**
 * Compute windowed totals for a file (used for the r/e/w/q breakdown in CLI output).
 */
export function windowedTotals(fa: FileAnalytics, windowDays: number): FileAnalyticsTotal {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  const totals: FileAnalyticsTotal = {
    readCount: 0,
    editCount: 0,
    writeCount: 0,
    canopyQueryCount: 0,
    grepHitCount: 0,
    globHitCount: 0,
    ripgrepHitCount: 0,
  };
  for (const [date, bucket] of Object.entries(fa.days)) {
    if (date >= cutoff) {
      totals.readCount += bucket.readCount ?? 0;
      totals.editCount += bucket.editCount ?? 0;
      totals.writeCount += bucket.writeCount ?? 0;
      totals.canopyQueryCount += bucket.canopyQueryCount ?? 0;
      totals.grepHitCount = (totals.grepHitCount ?? 0) + (bucket.grepHitCount ?? 0);
      totals.globHitCount = (totals.globHitCount ?? 0) + (bucket.globHitCount ?? 0);
      totals.ripgrepHitCount = (totals.ripgrepHitCount ?? 0) + (bucket.ripgrepHitCount ?? 0);
    }
  }
  return totals;
}
