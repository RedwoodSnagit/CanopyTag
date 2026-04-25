import { describe, expect, it } from 'vitest';
import type { AgentManifest } from '../../shared/types.js';
import { buildAgentManifestReport } from '../tools/agent-manifest.js';

const manifest: AgentManifest = {
  version: 1,
  entries: [
    {
      id: 'AM-001',
      file: 'src/old.ts',
      createdAt: '2026-04-10T00:00:00.000Z',
      author: { role: 'agent', name: 'claude' },
      status: 'rejected',
      kind: 'comment',
      headline: 'Added note comment',
      applied: true,
      comment: 'Not needed after follow-up.',
    },
    {
      id: 'AM-002',
      file: 'src/auth.ts',
      createdAt: '2026-04-22T15:00:00.000Z',
      author: { role: 'agent', name: 'claude' },
      status: 'pending',
      kind: 'annotate',
      headline: 'Updated metadata: summary',
      applied: true,
      proposal: {
        summary: 'Review token rotation guidance.',
        relatedFiles: [{ path: 'tests/auth.test.ts', closeness: 5, relation: 'test-of' }],
      },
      suggestedFreshness: 'stale',
      followUps: ['tests/auth.test.ts'],
    },
  ],
};

describe('buildAgentManifestReport', () => {
  it('shows only pending entries by default', () => {
    const report = buildAgentManifestReport(manifest);

    expect(report).toContain('Pending manifest entries: 1');
    expect(report).toContain('AM-002');
    expect(report).not.toContain('AM-001');
    expect(report).toContain('headline: Updated metadata: summary');
    expect(report).toContain('suggested freshness: Stale');
  });

  it('can show all entry statuses', () => {
    const report = buildAgentManifestReport(manifest, { all: true });

    expect(report).toContain('Manifest entries: 2');
    expect(report).toContain('AM-001');
    expect(report).toContain('AM-002');
  });

  it('filters to a single file', () => {
    const report = buildAgentManifestReport(manifest, { file: 'src/auth.ts' });

    expect(report).toContain('src/auth.ts');
    expect(report).not.toContain('src/old.ts');
  });
});
