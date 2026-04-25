import { describe, expect, it } from 'vitest';
import type { AgentManifestEntry } from '../../shared/types';
import { buildManifestKinds, buildManifestPreview, filterManifestRowsByRecency, toManifestRow } from './TableView';

function entry(overrides: Partial<AgentManifestEntry> = {}): AgentManifestEntry {
  return {
    id: 'AM-001',
    file: 'src/auth.ts',
    createdAt: '2026-04-22T12:00:00.000Z',
    author: { role: 'agent', name: 'claude' },
    status: 'pending',
    ...overrides,
  };
}

describe('TableView manifest helpers', () => {
  it('builds a compact preview from staged fields', () => {
    const preview = buildManifestPreview(entry({
      headline: 'Updated metadata: summary, tags',
      proposal: { summary: 'Review token rotation guidance.', tags: ['auth'] },
      comment: 'Might be missing logout caveats.',
      todo: { text: 'Audit session invalidation' },
      followUps: ['tests/auth.test.ts', 'src/api.ts', 'docs/auth.md'],
      reviewNote: 'Human agreed with one caveat.',
    }));

    expect(preview).toContain('Updated metadata: summary, tags');
    expect(preview).toContain('Review token rotation guidance.');
    expect(preview).toContain('Comment: Might be missing logout caveats.');
    expect(preview).toContain('TODO: Audit session invalidation');
    expect(preview).toContain('Follow-ups: tests/auth.test.ts, src/api.ts +1');
    expect(preview).toContain('Review: Human agreed with one caveat.');
  });

  it('labels freshness signals as activity kinds', () => {
    const kinds = buildManifestKinds(entry({ suggestedFreshness: 'stale', applied: true, kind: 'annotate' }));
    const row = toManifestRow(entry({ suggestedFreshness: 'review-drift' }));

    expect(kinds).toContain('Applied');
    expect(kinds).toContain('Meta');
    expect(kinds).toContain('Stale');
    expect(row.kinds).toContain('Review Drift');
  });

  it('filters manifest rows by recency window', () => {
    const recent = toManifestRow(entry({ id: 'AM-001', createdAt: '2026-04-21T12:00:00.000Z' }));
    const older = toManifestRow(entry({ id: 'AM-002', createdAt: '2026-03-10T12:00:00.000Z' }));

    const rows = filterManifestRowsByRecency([recent, older], '30d', new Date('2026-04-23T12:00:00.000Z'));

    expect(rows).toEqual([recent]);
  });
});
