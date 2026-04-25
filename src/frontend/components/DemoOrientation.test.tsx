import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY,
  DEMO_ORIENTATION_STORAGE_KEY,
  DEMO_ORIENTATION_STEPS,
  DemoOrientation,
  DemoOrientationPanel,
  hasDismissedDemoOrientation,
  persistDemoOrientationSkipLaunch,
  shouldSkipDemoOrientationLaunch,
} from './DemoOrientation';

describe('DemoOrientation', () => {
  it('keeps the guide hidden outside the bundled demo', () => {
    const html = renderToStaticMarkup(<DemoOrientation isDemo={false} />);

    expect(html).toBe('');
  });

  it('explains the forest_repo_demo walkthrough areas', () => {
    const html = renderToStaticMarkup(
      <DemoOrientationPanel
        titleId="demo-guide-title"
        skipLaunch={false}
        onDismiss={() => {}}
        onSkipLaunchChange={() => {}}
      />,
    );

    expect(html).toContain('Welcome to forest_repo_demo');
    expect(html).toContain('agent activity');
    expect(html).toContain('forest ecosystem');
    expect(html).toContain('dogfoods itself');
    expect(html).toContain('launch on demo start');
    expect(html).toContain('Reviewed scores');
    expect(html).toContain('Related files');
    for (const step of DEMO_ORIENTATION_STEPS) {
      expect(html).toContain(step.label);
    }
  });

  it('reads the dismissed state from storage defensively', () => {
    const dismissedStorage = {
      getItem: (key: string) => key === DEMO_ORIENTATION_STORAGE_KEY ? 'true' : null,
    } as Storage;
    const blockedStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    expect(hasDismissedDemoOrientation(dismissedStorage)).toBe(true);
    expect(hasDismissedDemoOrientation(blockedStorage)).toBe(false);
    expect(hasDismissedDemoOrientation(null)).toBe(false);
  });

  it('uses an explicit skip-launch preference instead of old dismissals', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    const legacyDismissedStorage = {
      getItem: (key: string) => key === 'canopytag.demoOrientation.dismissed.v1' ? 'true' : null,
    } as Storage;

    expect(shouldSkipDemoOrientationLaunch(legacyDismissedStorage)).toBe(false);

    persistDemoOrientationSkipLaunch(true, storage);
    expect(values.get(DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY)).toBe('true');
    expect(shouldSkipDemoOrientationLaunch(storage)).toBe(true);

    persistDemoOrientationSkipLaunch(false, storage);
    expect(values.has(DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY)).toBe(false);
    expect(shouldSkipDemoOrientationLaunch(storage)).toBe(false);
  });
});
