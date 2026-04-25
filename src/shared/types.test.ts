import { describe, expect, it } from 'vitest';
import { checkFreshness } from './types';

describe('checkFreshness', () => {
  it('returns null when no freshness signals exist', () => {
    expect(checkFreshness({})).toBeNull();
  });

  it('returns unknown when a file has not been reviewed yet', () => {
    expect(checkFreshness({ lastModified: '2026-04-20' })).toBe('unknown');
  });

  it('returns fresh when review is at least as recent as the file change', () => {
    expect(checkFreshness({
      lastModified: '2026-04-20',
      lastReviewed: '2026-04-20',
    })).toBe('fresh');
  });

  it('returns review-drift when the file changed after the last review', () => {
    expect(checkFreshness({
      lastModified: '2026-04-20',
      lastReviewed: '2026-04-19',
    })).toBe('review-drift');
  });

  it('returns review-drift when a close related file changed after the last review', () => {
    expect(checkFreshness({
      lastReviewed: '2026-04-19',
      relatedModifiedDates: ['2026-04-18', '2026-04-20'],
    })).toBe('review-drift');
  });

  it('stays fresh when related-file changes are older than the last review', () => {
    expect(checkFreshness({
      lastReviewed: '2026-04-20',
      relatedModifiedDates: ['2026-04-18', '2026-04-19'],
    })).toBe('fresh');
  });
});
