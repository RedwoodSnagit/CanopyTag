import { describe, expect, it } from 'vitest';
import type { CanopyAnalytics, FileAnalytics } from '../../shared/types';
import { buildHeatMap, heatBreakdown } from './FileTree';

function fileAnalytics(days: FileAnalytics['days']): FileAnalytics {
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
    days,
    firstAccessedAt: '2026-04-24T00:00:00.000Z',
    lastAccessedAt: '2026-04-24T00:00:00.000Z',
  };
}

describe('FileTree heat helpers', () => {
  it('weights edits and writes above reads and queries', () => {
    const today = new Date().toISOString().slice(0, 10);
    const heat = heatBreakdown(fileAnalytics({
      [today]: {
        readCount: 2,
        editCount: 3,
        writeCount: 1,
        canopyQueryCount: 4,
        grepHitCount: 2,
        globHitCount: 1,
        ripgrepHitCount: 3,
      },
    }));

    expect(heat).toEqual({
      reads: 2,
      edits: 3,
      writes: 1,
      queries: 4,
      grepHits: 2,
      globHits: 1,
      ripgrepHits: 3,
      score: 20,
    });
  });

  it('normalizes each file against the hottest file in the window', () => {
    const today = new Date().toISOString().slice(0, 10);
    const analytics: CanopyAnalytics = {
      version: 1,
      files: {
        'src/hot.ts': fileAnalytics({ [today]: { editCount: 5 } }),
        'src/warm.ts': fileAnalytics({ [today]: { readCount: 5 } }),
        'src/cold.ts': fileAnalytics({}),
      },
      daily: {},
    };

    const heatMap = buildHeatMap(analytics);

    expect(heatMap.get('src/hot.ts')?.score).toBe(10);
    expect(heatMap.get('src/hot.ts')?.intensity).toBe(1);
    expect(heatMap.get('src/warm.ts')?.intensity).toBe(0.5);
    expect(heatMap.get('src/cold.ts')?.intensity).toBe(0);
  });
});
