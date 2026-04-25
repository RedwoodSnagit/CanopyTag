import { describe, expect, it } from 'vitest';
import { checkAuthorityHealth } from '../../shared/types';

describe('checkAuthorityHealth', () => {
  it('returns health for canonical authority levels', () => {
    const health = checkAuthorityHealth({
      authorityLevel: 'guideline',
      validity: 3,
      clarity: 3,
      completeness: 2,
      stability: 2,
    });

    expect(health).toMatchObject({
      authorityLevel: 'guideline',
      expectedRange: [8, 16],
      aggregate: 10,
      status: 'healthy',
    });
  });

  it('rejects non-canonical authority values', () => {
    const health = checkAuthorityHealth({
      authorityLevel: 'exploration',
      validity: 4,
      clarity: 4,
      completeness: 4,
      stability: 4,
    } as any);

    expect(health).toBeNull();
  });
});
