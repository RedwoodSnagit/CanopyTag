import { describe, expect, it } from 'vitest';
import { AUTHORITY_HELP_TEXT, authorityLevelDisplay, formatAuthorityLabel } from './authority';

describe('authority display helpers', () => {
  it('uses code-friendly display labels without changing canonical values', () => {
    const level = authorityLevelDisplay('specification');

    expect(level?.label).toBe('Spec');
    expect(level?.canonicalLabel).toBe('Specification');
    expect(formatAuthorityLabel('specification')).toBe('4 - Spec');
    expect(formatAuthorityLabel('specification', true)).toBe('4-Spec');
  });

  it('explains authority as hierarchy for conflict resolution', () => {
    expect(AUTHORITY_HELP_TEXT).toContain('Authority is hierarchy');
    expect(AUTHORITY_HELP_TEXT).toContain('prefer the higher-authority source');
  });
});
