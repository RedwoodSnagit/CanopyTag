import { describe, it, expect } from 'vitest';
import {
  emptyAnalytics,
  incrementFile,
  incrementDaily,
  engagementScore,
} from '../lib/analytics.js';
import type { CanopyAnalytics } from '../../shared/types.js';

describe('incrementFile', () => {
  it('initializes a new file entry with all counters at zero except the incremented one', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-04');
    expect(a.files['src/auth.ts'].total).toEqual({
      readCount: 1,
      editCount: 0,
      writeCount: 0,
      canopyQueryCount: 0,
      grepHitCount: 0,
      globHitCount: 0,
      ripgrepHitCount: 0,
    });
  });

  it('sets firstAccessedAt on first touch and does not overwrite it', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-04');
    const first = a.files['src/auth.ts'].firstAccessedAt;
    expect(first).toBeTruthy();
    incrementFile(a, 'src/auth.ts', 'editCount', '2026-04-04');
    expect(a.files['src/auth.ts'].firstAccessedAt).toBe(first);
  });

  it('accumulates counts across multiple calls on the same day', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-04');
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-04');
    incrementFile(a, 'src/auth.ts', 'editCount', '2026-04-04');
    expect(a.files['src/auth.ts'].days['2026-04-04']).toEqual({ readCount: 2, editCount: 1 });
    expect(a.files['src/auth.ts'].total.readCount).toBe(2);
    expect(a.files['src/auth.ts'].total.editCount).toBe(1);
  });

  it('tracks counts across different days independently', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-04');
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-05');
    expect(a.files['src/auth.ts'].days['2026-04-04'].readCount).toBe(1);
    expect(a.files['src/auth.ts'].days['2026-04-05'].readCount).toBe(1);
    expect(a.files['src/auth.ts'].total.readCount).toBe(2);
  });

  it('increments uniqueFilesAccessed on first event for a file today only', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'readCount', '2026-04-04');
    expect(a.daily['2026-04-04'].uniqueFilesAccessed).toBe(1);
    // Second event same file same day — no increment
    incrementFile(a, 'src/auth.ts', 'editCount', '2026-04-04');
    expect(a.daily['2026-04-04'].uniqueFilesAccessed).toBe(1);
    // Different file same day — increments
    incrementFile(a, 'src/middleware.ts', 'readCount', '2026-04-04');
    expect(a.daily['2026-04-04'].uniqueFilesAccessed).toBe(2);
  });

  it('handles canopyQueryCount field correctly', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'canopyQueryCount', '2026-04-04');
    expect(a.files['src/auth.ts'].total.canopyQueryCount).toBe(1);
    expect(a.files['src/auth.ts'].days['2026-04-04'].canopyQueryCount).toBe(1);
  });

  it('tracks search result hits without counting them as opened files', () => {
    const a = emptyAnalytics();
    incrementFile(a, 'src/auth.ts', 'grepHitCount', '2026-04-04');
    incrementFile(a, 'src/auth.ts', 'globHitCount', '2026-04-04');
    incrementFile(a, 'src/auth.ts', 'ripgrepHitCount', '2026-04-04');

    expect(a.files['src/auth.ts'].total.grepHitCount).toBe(1);
    expect(a.files['src/auth.ts'].total.globHitCount).toBe(1);
    expect(a.files['src/auth.ts'].total.ripgrepHitCount).toBe(1);
    expect(a.daily['2026-04-04']?.uniqueFilesAccessed ?? 0).toBe(0);
  });
});

describe('incrementDaily', () => {
  it('increments grepCount without touching other fields', () => {
    const a = emptyAnalytics();
    incrementDaily(a, 'grepCount', '2026-04-04');
    incrementDaily(a, 'grepCount', '2026-04-04');
    expect(a.daily['2026-04-04'].grepCount).toBe(2);
    expect(a.daily['2026-04-04'].globCount).toBe(0);
    expect(a.daily['2026-04-04'].uniqueFilesAccessed).toBe(0);
  });

  it('increments globCount independently of grepCount', () => {
    const a = emptyAnalytics();
    incrementDaily(a, 'globCount', '2026-04-04');
    expect(a.daily['2026-04-04'].globCount).toBe(1);
    expect(a.daily['2026-04-04'].grepCount).toBe(0);
  });

  it('increments ripgrepCount independently of Claude Grep and Glob tools', () => {
    const a = emptyAnalytics();
    incrementDaily(a, 'ripgrepCount', '2026-04-04');
    expect(a.daily['2026-04-04'].ripgrepCount).toBe(1);
    expect(a.daily['2026-04-04'].grepCount).toBe(0);
    expect(a.daily['2026-04-04'].globCount).toBe(0);
  });

  it('never touches uniqueFilesAccessed', () => {
    const a = emptyAnalytics();
    incrementDaily(a, 'grepCount', '2026-04-04');
    incrementDaily(a, 'globCount', '2026-04-04');
    incrementDaily(a, 'ripgrepCount', '2026-04-04');
    expect(a.daily['2026-04-04'].uniqueFilesAccessed).toBe(0);
  });
});

describe('engagementScore', () => {
  it('computes weighted score over a window of days', () => {
    // Use fixed dates well in the future so they always fall within any window
    const a = emptyAnalytics();
    const futureDate = '2099-01-01';
    incrementFile(a, 'src/auth.ts', 'readCount', futureDate);       // +1
    incrementFile(a, 'src/auth.ts', 'readCount', futureDate);       // +1
    incrementFile(a, 'src/auth.ts', 'editCount', futureDate);       // +2
    incrementFile(a, 'src/auth.ts', 'writeCount', futureDate);      // +2
    incrementFile(a, 'src/auth.ts', 'canopyQueryCount', futureDate); // +1
    incrementFile(a, 'src/auth.ts', 'grepHitCount', futureDate);     // +1
    incrementFile(a, 'src/auth.ts', 'globHitCount', futureDate);     // +1
    incrementFile(a, 'src/auth.ts', 'ripgrepHitCount', futureDate);  // +1
    // score = 2 + 2 + 2 + 1 + 1 + 1 + 1 = 10
    expect(engagementScore(a.files['src/auth.ts'], 7)).toBe(10);
  });

  it('returns 0 for files with no activity in window', () => {
    const a = emptyAnalytics();
    // Use a very old date that will never be in a 7-day window
    incrementFile(a, 'src/auth.ts', 'readCount', '2000-01-01');
    expect(engagementScore(a.files['src/auth.ts'], 7)).toBe(0);
  });
});
