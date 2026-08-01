import { describe, expect, it } from 'vitest';
import { buildCompare } from '../compare';
import type { Canopy } from '../../shared/types';

const TEST_CANOPY: Canopy = {
  version: 1,
  repoRoot: '.',
  lastModifiedAt: '2026-04-25T00:00:00Z',
  files: {
    'docs/standard.md': {
      summary: 'Canonical behavior contract.',
      authorityLevel: 'standard',
      status: 'active',
      validity: 5,
      clarity: 4,
      completeness: 5,
      stability: 4,
      scoresReviewed: true,
      todos: [],
    },
    'docs/spec.md': {
      summary: 'Production-ready implementation spec.',
      authorityLevel: 'specification',
      status: 'active',
      validity: 5,
      clarity: 4,
      completeness: 2,
      stability: 3,
      scoresReviewed: false,
      todos: [{
        id: 'T-1',
        text: 'Fill the missing edge case.',
        priority: 2,
        status: 'open',
        createdAt: '2026-04-01T00:00:00Z',
        createdBy: { role: 'human', name: 'reviewer' },
      }],
    },
    'docs/idea.md': {
      summary: 'Early notes.',
      authorityLevel: 'idea',
      status: 'draft',
      validity: 2,
      clarity: 3,
    },
  },
  features: {},
};

describe('buildCompare', () => {
  it('compares authority, quality, warnings, TODO pressure, and trust order', () => {
    const { text, matchedPaths } = buildCompare(TEST_CANOPY, [
      'docs/spec.md',
      'docs/standard.md',
      'docs/missing.md',
    ]);

    expect(matchedPaths).toEqual(['docs/spec.md', 'docs/standard.md']);
    expect(text).toContain('Compared 2/3 annotated files.');
    expect(text).toContain('docs/standard.md');
    expect(text).toContain('5-Standard');
    expect(text).toContain('18/20');
    expect(text).toContain('docs/spec.md');
    expect(text).toContain('4-Spec');
    expect(text).toContain('14/20');
    expect(text).toContain('unreviewed scores');
    expect(text).toContain('1 warning');
    expect(text).toContain('1 P2');
    expect(text).toMatch(/1\. docs\/standard\.md/);
    expect(text).toMatch(/2\. docs\/spec\.md/);
    expect(text).toContain('Not annotated:');
    expect(text).toContain('- docs/missing.md');
  });

  it('shows partial score coverage for incomplete quality dimensions', () => {
    const { text } = buildCompare(TEST_CANOPY, ['docs/idea.md']);

    expect(text).toContain('1-Idea');
    expect(text).toContain('5/20 (2/4)');
    expect(text).toContain('valid:2 clear:3 complete:- stable:-');
  });

  it('normalizes Windows-style path separators before matching canopy entries', () => {
    const { text, matchedPaths } = buildCompare(TEST_CANOPY, ['.\\docs\\spec.md']);

    expect(matchedPaths).toEqual(['docs/spec.md']);
    expect(text).toContain('Compared 1/1 annotated file.');
    expect(text).toContain('docs/spec.md');
  });

  it('reports when none of the requested files are annotated', () => {
    const { text, matchedPaths } = buildCompare(TEST_CANOPY, ['nope.ts']);

    expect(matchedPaths).toEqual([]);
    expect(text).toContain('No requested files are annotated.');
    expect(text).toContain('- nope.ts');
  });

  it('shows lifecycle state without changing authority precedence', () => {
    const canopy: Canopy = {
      ...TEST_CANOPY,
      files: {
        ...TEST_CANOPY.files,
        'docs/standard.md': {
          ...TEST_CANOPY.files['docs/standard.md'],
          lifecycleMarks: [{
            id: 'LM-001',
            type: 'temporary_contract',
            reason: 'Temporary release contract.',
            createdAt: '2026-07-01T00:00:00Z',
            createdBy: 'human',
            expiresAt: '2026-07-15',
          }],
        },
      },
    };

    const { text } = buildCompare(
      canopy,
      ['docs/standard.md', 'docs/spec.md'],
      undefined,
      '2026-07-16',
    );

    expect(text).toContain('LIFECYCLE');
    expect(text).toContain('expired:1');
    expect(text).toContain('Lifecycle warnings:');
    expect(text).toContain('EXPIRED temporary contract [LM-001]');
    expect(text).toMatch(/1\. docs\/standard\.md/);
  });

  it('surfaces null lifecycle metadata as INVALID without changing trust order', () => {
    const canopy: Canopy = {
      ...TEST_CANOPY,
      files: {
        ...TEST_CANOPY.files,
        'docs/standard.md': {
          ...TEST_CANOPY.files['docs/standard.md'],
          lifecycleMarks: null as any,
        },
      },
    };

    const { text } = buildCompare(canopy, ['docs/standard.md', 'docs/spec.md']);
    expect(text).toContain('invalid:1');
    expect(text).toContain('INVALID lifecycle mark');
    expect(text).toMatch(/1\. docs\/standard\.md/);
  });
});
