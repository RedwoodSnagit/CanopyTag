import type { Priority } from '../../shared/types';

/** CSS custom-property references for priority colors (P1–P5). */
export const PRIORITY_COLORS: Record<Priority, string> = {
  1: 'var(--color-p1)',
  2: 'var(--color-p2)',
  3: 'var(--color-p3)',
  4: 'var(--color-p4)',
  5: 'var(--color-p5)',
};

/** Tailwind class for closeness-dot background. */
export const CLOSENESS_BG: Record<number, string> = {
  5: 'bg-closeness-5',
  4: 'bg-closeness-4',
  3: 'bg-closeness-3',
  2: 'bg-closeness-2',
  1: 'bg-closeness-1',
};

/** Map an engagement score to a CSS color value for heat dots. */
export function heatColor(score: number): string | null {
  if (score <= 0) return null;
  if (score <= 5) return 'var(--color-heat-low)';
  if (score <= 14) return 'var(--color-heat-med)';
  if (score <= 29) return 'var(--color-heat-high)';
  return 'var(--color-heat-max)';
}
