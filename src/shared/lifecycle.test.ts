import { describe, expect, it } from 'vitest';
import type { LifecycleMark } from './types.js';
import {
  assessLifecycleMarks,
  currentLocalIsoDay,
  deriveLifecycleState,
  describeLifecycleAssessment,
} from './lifecycle.js';

function mark(overrides: Partial<LifecycleMark> = {}): LifecycleMark {
  return {
    id: 'LM-001',
    type: 'temporary_contract',
    reason: 'Private alpha behavior needs a bounded review window.',
    createdAt: '2026-07-01T12:00:00Z',
    createdBy: { role: 'human', name: 'reviewer' },
    ...overrides,
  };
}

describe('deriveLifecycleState', () => {
  it('keeps a mark open before its review and expiration dates', () => {
    expect(deriveLifecycleState(mark({
      reviewAfter: '2026-07-08',
      expiresAt: '2026-07-15',
    }), '2026-07-07')).toBe('open');
  });

  it('is due on the review date', () => {
    expect(deriveLifecycleState(mark({ reviewAfter: '2026-07-08' }), '2026-07-08'))
      .toBe('due');
  });

  it('expires only after the expiration date and takes precedence over due', () => {
    const candidate = mark({
      reviewAfter: '2026-07-08',
      expiresAt: '2026-07-15',
    });
    expect(deriveLifecycleState(candidate, '2026-07-15')).toBe('due');
    expect(deriveLifecycleState(candidate, '2026-07-16')).toBe('expired');
  });

  it('lets explicit resolution win over stored dates', () => {
    expect(deriveLifecycleState(mark({
      state: 'resolved',
      resolvedAt: '2026-07-10T12:00:00Z',
      expiresAt: '2026-07-01',
    }), '2026-07-16')).toBe('resolved');
  });

  it('keeps non-date temporal boundaries open until explicitly resolved', () => {
    expect(deriveLifecycleState(mark({
      temporalDependence: 'event_bound',
      temporalNote: 'Valid until migration cutover.',
    }), '2026-07-16')).toBe('open');
  });

  it('rejects an invalid as-of date instead of consulting the clock', () => {
    expect(() => deriveLifecycleState(mark(), 'not-a-date')).toThrow(/as-of date/);
    expect(() => deriveLifecycleState(mark(), '2026-07-08T12:00:00Z')).toThrow(/YYYY-MM-DD/);
  });

  it('uses the machine local calendar day instead of UTC day slicing', () => {
    const localDate = new Date(2026, 6, 8, 23, 30, 0);
    expect(currentLocalIsoDay(localDate)).toBe('2026-07-08');
  });
});

describe('lifecycle assessment rendering', () => {
  it('keeps evidence and successor paths visible in a compact warning', () => {
    const [assessment] = assessLifecycleMarks([mark({
      type: 'superseded',
      supersededBy: ['docs/current.md'],
      reviewAfter: '2026-07-08',
    })], '2026-07-09');

    expect(describeLifecycleAssessment(assessment)).toContain('REVIEW DUE superseded [LM-001]');
    expect(describeLifecycleAssessment(assessment)).toContain('successor: docs/current.md');
  });

  it.each([
    ['object', { id: 'LM-container' }],
    ['null', null],
    ['number', 42],
  ])('turns a malformed %s lifecycle_marks container into an INVALID finding', (_label, raw) => {
    const [assessment] = assessLifecycleMarks(raw, '2026-07-09');

    expect(assessment.state).toBe('invalid');
    expect(assessment.raw).toBe(raw);
    expect(describeLifecycleAssessment(assessment)).toContain('INVALID lifecycle mark');
    expect(describeLifecycleAssessment(assessment)).toContain('must be an array');
  });

  it.each([null, 7])('turns a malformed lifecycle mark item into an INVALID finding', raw => {
    const [assessment] = assessLifecycleMarks([raw], '2026-07-09');

    expect(assessment.state).toBe('invalid');
    expect(assessment.raw).toBe(raw);
    expect(describeLifecycleAssessment(assessment)).toContain('must be an object');
  });

  it.each([
    ['datetime', '2026-07-08T12:00:00Z'],
    ['garbage', 'soon'],
    ['impossible date', '2026-02-30'],
  ])('rejects a %s in review_after without throwing from tolerant assessment', (_label, reviewAfter) => {
    const raw = mark({ reviewAfter });
    const [assessment] = assessLifecycleMarks([raw], '2026-07-09');

    expect(assessment.state).toBe('invalid');
    expect(assessment.raw).toBe(raw);
    expect(describeLifecycleAssessment(assessment)).toContain('review_after must be a valid YYYY-MM-DD');
  });

  it('reports malformed required and enum fields without trying to coerce them', () => {
    const raw = {
      id: 12,
      type: 'temporary-ish',
      reason: null,
      createdAt: 'yesterday',
      createdBy: { role: 'robot' },
      state: 'closed',
    };
    const [assessment] = assessLifecycleMarks([raw], '2026-07-09');

    expect(assessment.state).toBe('invalid');
    expect(assessment.issues).toHaveLength(6);
    expect(describeLifecycleAssessment(assessment)).toContain('type is not recognized');
  });
});
