import { describe, expect, it } from 'vitest';
import type { Canopy } from '../../shared/types.js';
import { buildHealth } from '../health.js';

const CANOPY: Canopy = {
  version: 1,
  repoRoot: '.',
  lastModifiedAt: '2026-07-01T00:00:00Z',
  files: {
    'docs/expired.md': {
      authorityLevel: 'specification',
      validity: 4,
      clarity: 4,
      completeness: 4,
      stability: 4,
      lifecycleMarks: [{
        id: 'LM-001',
        type: 'temporary_contract',
        reason: 'Alpha-only contract.',
        createdAt: '2026-07-01T00:00:00Z',
        createdBy: 'human',
        expiresAt: '2026-07-15',
      }],
    },
    'docs/review.md': {
      lifecycleMarks: [{
        id: 'LM-002',
        type: 'review_needed',
        reason: 'Implementation may have changed.',
        createdAt: '2026-07-01T00:00:00Z',
        createdBy: 'agent',
      }],
    },
    'docs/resolved.md': {
      lifecycleMarks: [{
        id: 'LM-003',
        type: 'review_needed',
        state: 'resolved',
        reason: 'Already reviewed.',
        createdAt: '2026-07-01T00:00:00Z',
        createdBy: 'human',
        resolvedAt: '2026-07-10T00:00:00Z',
      }],
    },
    'docs/malformed.md': {
      lifecycleMarks: 17 as any,
    },
  },
  features: {},
};

describe('buildHealth lifecycle findings', () => {
  it('shows expired and open review-needed marks while hiding resolved marks', () => {
    const output = buildHealth(CANOPY, {}, false, undefined, '2026-07-16');

    expect(output).toContain('Lifecycle findings:');
    expect(output).toContain('EXPIRED temporary contract [LM-001]');
    expect(output).toContain('OPEN review needed [LM-002]');
    expect(output).toContain('INVALID lifecycle mark');
    expect(output).toContain('lifecycle_marks must be an array; received number');
    expect(output).not.toContain('LM-003');
  });
});
