import type { AuthorityLevel } from '../../shared/types';

export interface AuthorityLevelDisplay {
  value: AuthorityLevel;
  number: number;
  label: string;
  canonicalLabel: string;
  description: string;
}

export const AUTHORITY_HELP_TEXT =
  'Authority is hierarchy. If two CanopyTag entries conflict, prefer the higher-authority source. Lower-authority entries are useful context, but should be scrutinized before they override higher authority.';

export const AUTHORITY_LEVELS: AuthorityLevelDisplay[] = [
  {
    value: 'idea',
    number: 1,
    label: 'Idea',
    canonicalLabel: 'Idea',
    description: 'Can be built on, but should not be trusted as authority yet.',
  },
  {
    value: 'blueprint',
    number: 2,
    label: 'Blueprint',
    canonicalLabel: 'Blueprint',
    description: 'An in-work design, code path, or document with a coherent direction.',
  },
  {
    value: 'guideline',
    number: 3,
    label: 'Guide',
    canonicalLabel: 'Guideline',
    description: 'Pretty good and authoritative, but not fully hardened yet.',
  },
  {
    value: 'specification',
    number: 4,
    label: 'Spec',
    canonicalLabel: 'Specification',
    description: 'Built to spec: solid, production-ready behavior or guidance.',
  },
  {
    value: 'standard',
    number: 5,
    label: 'Standard',
    canonicalLabel: 'Standard',
    description: 'Canon: master rules or canonical files that should rarely change.',
  },
];

export function authorityLevelDisplay(value?: string): AuthorityLevelDisplay | undefined {
  return AUTHORITY_LEVELS.find(level => level.value === value);
}

export function formatAuthorityLabel(value?: string, compact = false): string {
  const level = authorityLevelDisplay(value);
  if (!level) return value ?? '-';
  return `${level.number}${compact ? '-' : ' - '}${level.label}`;
}
