import { describe, it, expect } from 'vitest';
import { getDimensionWarnings, buildContext } from '../context';
import type { Canopy, FileCanopy } from '../../shared/types';

// ---- getDimensionWarnings ----

describe('getDimensionWarnings', () => {
  it('returns no warnings for ideas (threshold 0)', () => {
    const fc: FileCanopy = {
      authorityLevel: 'idea',
      validity: 1, clarity: 1, completeness: 1, stability: 1,
    };
    expect(getDimensionWarnings(fc)).toEqual([]);
  });

  it('returns no warnings when all scores meet threshold', () => {
    const fc: FileCanopy = {
      authorityLevel: 'specification',
      validity: 4, clarity: 3, completeness: 3, stability: 3,
    };
    expect(getDimensionWarnings(fc)).toEqual([]);
  });

  it('flags dimensions below minimum for specification (threshold 3)', () => {
    const fc: FileCanopy = {
      authorityLevel: 'specification',
      validity: 5, clarity: 4, completeness: 2, stability: 2,
    };
    const warnings = getDimensionWarnings(fc);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toEqual({ dimension: 'completeness', score: 2, minimum: 3 });
    expect(warnings[1]).toEqual({ dimension: 'stability', score: 2, minimum: 3 });
  });

  it('flags dimensions below minimum for standard (threshold 4)', () => {
    const fc: FileCanopy = {
      authorityLevel: 'standard',
      validity: 5, clarity: 3, completeness: 5, stability: 4,
    };
    const warnings = getDimensionWarnings(fc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({ dimension: 'clarity', score: 3, minimum: 4 });
  });

  it('skips dimensions with no score', () => {
    const fc: FileCanopy = {
      authorityLevel: 'guideline',
      validity: 3,
      // clarity, completeness, stability undefined
    };
    expect(getDimensionWarnings(fc)).toEqual([]);
  });

  it('returns no warnings when no authority level', () => {
    const fc: FileCanopy = { validity: 1, clarity: 1 };
    expect(getDimensionWarnings(fc)).toEqual([]);
  });
});

// ---- buildContext ----

const TEST_CANOPY: Canopy = {
  version: 1,
  repoRoot: '.',
  lastModifiedAt: '2026-03-27T12:00:00Z',
  files: {
    'src/core.ts': {
      summary: 'Core module with the main logic.',
      authorityLevel: 'specification',
      status: 'active',
      lastReviewed: '2026-04-19',
      validity: 5,
      clarity: 4,
      completeness: 2,
      stability: 3,
      scoresReviewed: false,
      featureId: 'engine',
      tags: ['core', 'critical'],
      todos: [
        {
          id: 'T-001',
          text: 'Handle edge case in parser',
          priority: 2,
          status: 'open',
          createdAt: '2026-03-20T10:00:00Z',
          createdBy: { role: 'human', name: 'jeff' },
        },
        {
          id: 'T-002',
          text: 'Already done',
          priority: 3,
          status: 'done',
          createdAt: '2026-03-19T10:00:00Z',
          createdBy: { role: 'agent', name: 'claude' },
        },
      ],
      relatedFiles: [
        { path: 'src/types.ts', closeness: 5, relation: 'fed-by' as const },
        { path: 'src/utils.ts', closeness: 3 },
        { path: 'docs/spec.md', closeness: 2, relation: 'doc-for' as const },
      ],
    },
    'src/types.ts': {
      summary: 'Type definitions.',
      authorityLevel: 'standard',
      status: 'active',
      validity: 5,
      clarity: 5,
      completeness: 4,
      stability: 4,
      scoresReviewed: true,
      featureId: 'engine',
      tags: ['core'],
    },
    'src/helper.ts': {
      summary: 'Helper utilities for the engine.',
      authorityLevel: 'guideline',
      status: 'active',
      validity: 3,
      clarity: 2,
      completeness: 1,
      stability: 3,
      scoresReviewed: false,
      featureId: 'engine',
      tags: ['utilities'],
    },
    'docs/readme.md': {
      summary: 'Project readme.',
      authorityLevel: 'guideline',
      status: 'active',
      featureId: 'docs',
      tags: ['docs'],
    },
  },
  features: {
    engine: {
      name: 'Core Engine',
      description: 'The main processing pipeline.',
      status: 'active',
      canonicalFile: 'docs/engine.md',
      owners: [{ role: 'human', name: 'jeff' }],
      openQuestions: ['Should parser recovery be documented as part of the feature contract?'],
      promotionStatus: 'endorsed',
    },
    docs: { name: 'Documentation' },
  },
};

describe('buildContext — file mode', () => {
  it('renders file header, summary, and tags', () => {
    const out = buildContext(TEST_CANOPY, { file: 'src/core.ts' });
    expect(out).toContain('src/core.ts — specification (active)');
    expect(out).toContain('Core module with the main logic.');
    expect(out).toContain('Tags: core, critical');
  });

  it('shows review drift when the file or close relations changed after review', () => {
    const out = buildContext(TEST_CANOPY, {
      file: 'src/core.ts',
      gitDates: new Map([
        ['src/core.ts', '2026-04-20'],
        ['src/types.ts', '2026-04-18'],
      ]),
    });
    expect(out).toContain('Review: Review Drift');
  });

  it('shows dimension warnings for scores below authority threshold', () => {
    const out = buildContext(TEST_CANOPY, { file: 'src/core.ts' });
    expect(out).toContain('⚠ completeness: 2/5 — below 3 expected for specification');
    expect(out).not.toContain('⚠ validity');  // 5 is above threshold
    expect(out).not.toContain('⚠ clarity');   // 4 is above threshold
  });

  it('shows unreviewed scores warning', () => {
    const out = buildContext(TEST_CANOPY, { file: 'src/core.ts' });
    expect(out).toContain('⚠ scores not human-reviewed');
  });

  it('does not show unreviewed warning for reviewed files', () => {
    const out = buildContext(TEST_CANOPY, {
      file: 'src/types.ts',
      gitDates: new Map([['src/types.ts', '2026-03-20']]),
    });
    expect(out).toContain('Review: Unknown');
    expect(out).not.toContain('unreviewed');
  });

  it('shows open TODOs but not done ones', () => {
    const out = buildContext(TEST_CANOPY, { file: 'src/core.ts' });
    expect(out).toContain('T-001(P2)');
    expect(out).not.toContain('T-002');
  });

  it('shows relations filtered by depth', () => {
    // Default depth 4: only closeness >= 4
    const out4 = buildContext(TEST_CANOPY, { file: 'src/core.ts' });
    expect(out4).toContain('src/types.ts');
    expect(out4).not.toContain('src/utils.ts');     // closeness 3
    expect(out4).not.toContain('docs/spec.md');     // closeness 2

    // Depth 2: closeness >= 2
    const out2 = buildContext(TEST_CANOPY, { file: 'src/core.ts', depth: 2 });
    expect(out2).toContain('src/types.ts');
    expect(out2).toContain('src/utils.ts');
    expect(out2).toContain('docs/spec.md');
  });

  it('returns error for unknown file', () => {
    const out = buildContext(TEST_CANOPY, { file: 'nonexistent.ts' });
    expect(out).toContain('No annotation found');
  });
});

describe('buildContext — feature mode', () => {
  it('renders feature header and description', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'engine' });
    expect(out).toContain('# Core Engine');
    expect(out).toContain('The main processing pipeline.');
    expect(out).toContain('Feature: status: active, promotion: endorsed');
    expect(out).toContain('Start: docs/engine.md');
    expect(out).toContain('Owners: human:jeff');
    expect(out).toContain('Open questions:');
  });

  it('shows aggregate dimension averages', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'engine' });
    expect(out).toContain('Avg scores:');
    expect(out).toContain('Weakest dimension:');
  });

  it('shows unreviewed count', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'engine' });
    // core.ts and helper.ts are unreviewed, types.ts is reviewed
    expect(out).toContain('2/3 files have unreviewed scores');
  });

  it('shows dimension warnings count', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'engine' });
    // core.ts: completeness=2 < 3 (1 warning), helper.ts: completeness=1 < 2 (1 warning)
    // helper.ts clarity=2 is NOT a warning (guideline threshold is 2, not above)
    expect(out).toMatch(/2 dimension warnings/);
  });

  it('includes all feature files sorted by authority', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'engine' });
    const typePos = out.indexOf('src/types.ts');
    const corePos = out.indexOf('src/core.ts');
    const helperPos = out.indexOf('src/helper.ts');
    // standard > specification > guideline
    expect(typePos).toBeLessThan(corePos);
    expect(corePos).toBeLessThan(helperPos);
  });

  it('collects open TODOs at the end', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'engine' });
    expect(out).toContain('Open TODOs:');
    expect(out).toContain('T-001 P2');
  });

  it('handles unknown feature gracefully', () => {
    const out = buildContext(TEST_CANOPY, { feature: 'nonexistent' });
    expect(out).toContain('No annotated files');
  });
});
