import { useMemo, useState, useEffect } from 'react';
import { useWorkspace } from '../stores/workspace';
import { api } from '../lib/api';
import { FileTree } from './FileTree';
import type { CanopyAnalytics, FileAnalytics } from '../../shared/types';

// ---- Scoring helpers (duplicated from backend for frontend use — no shared import) ----

function engagementScore(fa: FileAnalytics, windowDays: number): number {
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

function breakdownLabel(fa: FileAnalytics, windowDays: number): string {
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
  const parts: string[] = [];
  if (r > 0) parts.push(`${r}r`);
  if (e > 0) parts.push(`${e}e`);
  if (w > 0) parts.push(`${w}w`);
  if (q > 0) parts.push(`${q}q`);
  if (g > 0) parts.push(`${g}grep`);
  if (gl > 0) parts.push(`${gl}glob`);
  if (rg > 0) parts.push(`${rg}rg`);
  return parts.join(' ');
}

// ---- Sub-components ----

function EngagementBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div className="flex-1 bg-forest-800 rounded-sm h-1.5 overflow-hidden">
      <div
        className="h-full rounded-sm bg-heat-high"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function HotFilesList({
  analytics,
  onFileClick,
}: {
  analytics: CanopyAnalytics;
  onFileClick: (path: string) => void;
}) {
  const WINDOW = 7;
  const hotFiles = useMemo(() => {
    return Object.entries(analytics.files)
      .map(([filePath, fa]) => ({ filePath, score: engagementScore(fa, WINDOW), fa }))
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }, [analytics]);

  if (hotFiles.length === 0) {
    return (
      <div className="text-forest-500 text-xs">
        <p>No activity recorded yet.</p>
        <p className="mt-1">Install the hook: <code className="font-mono">canopytag-hook install</code></p>
      </div>
    );
  }

  const maxScore = hotFiles[0].score;
  return (
    <div className="space-y-1">
      {hotFiles.map(({ filePath, score, fa }) => (
        <button
          key={filePath}
          onClick={() => onFileClick(filePath)}
          className="w-full text-left group"
        >
          <div className="flex items-center gap-2">
            <span className="text-forest-400 text-xs font-mono truncate flex-1 group-hover:text-forest-200 transition-colors">
              {filePath}
            </span>
            <span className="text-forest-500 text-xs tabular-nums shrink-0">{score}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <EngagementBar score={score} max={maxScore} />
            <span className="text-forest-600 text-[10px] tabular-nums shrink-0">
              {breakdownLabel(fa, WINDOW)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function NavigationTrend({ analytics }: { analytics: CanopyAnalytics }) {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({
        key,
        label: DAY_NAMES[d.getDay()],
        grep: analytics.daily[key]?.grepCount ?? 0,
        glob: analytics.daily[key]?.globCount ?? 0,
        ripgrep: analytics.daily[key]?.ripgrepCount ?? 0,
      });
    }
    return result;
  }, [analytics]);

  const maxGrep = Math.max(1, ...days.map(d => d.grep));
  const maxGlob = Math.max(1, ...days.map(d => d.glob));
  const maxRipgrep = Math.max(1, ...days.map(d => d.ripgrep));
  const hasData = days.some(d => d.grep > 0 || d.glob > 0 || d.ripgrep > 0);

  if (!hasData) return null;

  return (
    <div>
      <h3 className="text-forest-400 text-xs font-medium uppercase tracking-wide mb-2">Navigation Trend</h3>
      <div className="space-y-1">
        {days.map(({ key, label, grep, glob, ripgrep }) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="text-forest-500 w-7 shrink-0">{label}</span>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-forest-600 w-6 text-right tabular-nums">{grep}</span>
              <div className="w-16 bg-forest-800 rounded-sm h-1.5">
                <div
                  className="h-full bg-forest-500 rounded-sm"
                  style={{ width: `${(grep / maxGrep) * 100}%` }}
                />
              </div>
              <span className="text-forest-600 text-[10px] ml-1">grep</span>
            </div>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-forest-600 w-6 text-right tabular-nums">{glob}</span>
              <div className="w-12 bg-forest-800 rounded-sm h-1.5">
                <div
                  className="h-full bg-forest-600 rounded-sm"
                  style={{ width: `${(glob / maxGlob) * 100}%` }}
                />
              </div>
              <span className="text-forest-600 text-[10px] ml-1">glob</span>
            </div>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-forest-600 w-6 text-right tabular-nums">{ripgrep}</span>
              <div className="w-12 bg-forest-800 rounded-sm h-1.5">
                <div
                  className="h-full bg-forest-700 rounded-sm"
                  style={{ width: `${(ripgrep / maxRipgrep) * 100}%` }}
                />
              </div>
              <span className="text-forest-600 text-[10px] ml-1">rg</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Main component ----

export function AnalyticsView() {
  const { analytics, setViewMode, selectFile } = useWorkspace();

  // settings is not in the workspace store — fetch directly
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  useEffect(() => {
    api.getSettings().then((s: any) => {
      setAnalyticsEnabled(s.analyticsEnabled !== false);
    }).catch(() => {});
  }, []);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayData = analytics?.daily[todayKey];

  const handleFileClick = (path: string) => {
    void selectFile(path);
    setViewMode('explorer');
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: file tree with heat bars enabled by default */}
      <aside className="w-72 border-r border-border overflow-y-auto flex flex-col">
        <FileTree defaultShowHeat />
      </aside>

      {/* Right: analytics panel */}
      <main className="flex-1 p-4 overflow-y-auto space-y-6">
        {!analyticsEnabled && (
          <div className="text-text-muted text-sm p-3 rounded border border-border bg-surface">
            Analytics paused. Enable in Settings to start recording agent activity.
          </div>
        )}

        {!analytics || Object.keys(analytics.files).length === 0 ? (
          <div className="text-forest-500 text-sm">
            <p>No analytics data yet.</p>
            <p className="mt-1 font-mono text-xs">canopytag-hook install</p>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-forest-300 text-sm font-semibold mb-3">
                Hot Files
                {analytics.clearedBefore && (
                  <span className="ml-2 text-forest-600 text-xs font-normal">since {analytics.clearedBefore}</span>
                )}
              </h2>
              <HotFilesList analytics={analytics} onFileClick={handleFileClick} />
            </div>

            <NavigationTrend analytics={analytics} />

            <div>
              <h3 className="text-forest-400 text-xs font-medium uppercase tracking-wide mb-2">Today</h3>
              <div className="flex gap-4 text-xs text-forest-400">
                <span>grep: <span className="text-forest-200 tabular-nums">{todayData?.grepCount ?? 0}</span></span>
                <span>glob: <span className="text-forest-200 tabular-nums">{todayData?.globCount ?? 0}</span></span>
                <span>rg: <span className="text-forest-200 tabular-nums">{todayData?.ripgrepCount ?? 0}</span></span>
                <span>files: <span className="text-forest-200 tabular-nums">{todayData?.uniqueFilesAccessed ?? 0}</span></span>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
