import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InfoTip, scoreButtonTitle } from './ScoreDisplay';

describe('InfoTip', () => {
  it('renders visible hover/focus tooltip content instead of only a decorative icon', () => {
    const html = renderToStaticMarkup(<InfoTip text="Helpful score context" />);

    expect(html).toContain('aria-label="Info: Helpful score context"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('Helpful score context');
    expect(html).toContain('group-focus-within:block');
  });
});

describe('scoreButtonTitle', () => {
  it('explains what a specific score value means for a dimension', () => {
    expect(scoreButtonTitle('clarity', 'Clarity', 3)).toBe(
      'Clarity 3/5: Understandable with some context.',
    );
    expect(scoreButtonTitle('stability', 'Stability', 5)).toContain('Very stable');
  });
});
