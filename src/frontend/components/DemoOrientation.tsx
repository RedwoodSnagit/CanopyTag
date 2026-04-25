import { useEffect, useId, useState } from 'react';

export const DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY = 'canopytag.demoOrientation.skipLaunch.v1';
export const DEMO_ORIENTATION_STORAGE_KEY = DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY;

export const DEMO_ORIENTATION_STEPS = [
  {
    label: 'Graph',
    text: 'Map how forest_repo_demo docs, code, tests, and data files connect.',
  },
  {
    label: 'Table',
    text: 'Scan Files, Scores, TODOs, and the Activity lane in one place.',
  },
  {
    label: 'Activity',
    text: 'Review agent activity: proposals, follow-ups, fixes, and notes.',
  },
  {
    label: 'Analytics',
    text: 'Spot hot files from agent reads, writes, and Canopy queries.',
  },
] as const;

const DEMO_ORIENTATION_DETAILS = [
  {
    label: 'Reviewed scores',
    text: 'Scores show quality and whether a human has reviewed them.',
  },
  {
    label: 'Related files',
    text: 'File detail links explain why neighboring files matter together.',
  },
] as const;

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function shouldSkipDemoOrientationLaunch(storage = getBrowserStorage()): boolean {
  try {
    return storage?.getItem(DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function hasDismissedDemoOrientation(storage = getBrowserStorage()): boolean {
  return shouldSkipDemoOrientationLaunch(storage);
}

export function persistDemoOrientationSkipLaunch(skipLaunch: boolean, storage = getBrowserStorage()) {
  try {
    if (skipLaunch) {
      storage?.setItem(DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY, 'true');
      return;
    }
    storage?.removeItem(DEMO_ORIENTATION_SKIP_LAUNCH_STORAGE_KEY);
  } catch {
    // This preference is a convenience only; blocked storage should not break the demo.
  }
}

export function DemoOrientationPanel({
  titleId,
  skipLaunch,
  onDismiss,
  onSkipLaunchChange,
}: {
  titleId: string;
  skipLaunch: boolean;
  onDismiss: () => void;
  onSkipLaunchChange: (skipLaunch: boolean) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="relative w-full max-w-2xl rounded-xl border border-border bg-surface p-5 shadow-2xl"
      onClick={event => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Bundled demo
          </p>
          <h2 id={titleId} className="text-xl font-semibold tracking-wide text-text-primary">
            Welcome to forest_repo_demo
          </h2>
        </div>
        <button
          onClick={onDismiss}
          className="rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="Dismiss demo guide"
        >
          Close
        </button>
      </div>

      <p className="mt-3 text-sm leading-6 text-text-secondary">
        forest_repo_demo is pre-filled with tags, scores, related files, and agent
        activity so you can see how CanopyTag orients humans and agents around a repo.
        The demo repo is themed with scripts and files that match a forest ecosystem.
        CanopyTag complements but does not replace reading the scripts in the repo:
        it is meant to be brief queryable context for agents and a few repo
        visualization tools for humans. CanopyTag dogfoods itself, so this app
        is also one of the repos its own annotations help explain.
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {DEMO_ORIENTATION_STEPS.map(step => (
          <div key={step.label} className="rounded-lg border border-border bg-canvas p-3">
            <h3 className="text-sm font-semibold text-text-primary">{step.label}</h3>
            <p className="mt-1 text-xs leading-5 text-text-secondary">{step.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-canvas p-3">
        <h3 className="text-sm font-semibold text-text-primary">Look for</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {DEMO_ORIENTATION_DETAILS.map(detail => (
            <p key={detail.label} className="text-xs leading-5 text-text-secondary">
              <span className="font-semibold text-text-primary">{detail.label}:</span>{' '}
              {detail.text}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={skipLaunch}
            onChange={event => onSkipLaunchChange(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-[var(--color-accent)]"
          />
          <span>Don&apos;t launch on demo start. You can still reopen this from the header.</span>
        </label>
        <button
          onClick={onDismiss}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Explore the demo
        </button>
      </div>
    </div>
  );
}

export function DemoOrientation({ isDemo }: { isDemo: boolean }) {
  const titleId = useId();
  const [skipLaunch, setSkipLaunch] = useState(() => shouldSkipDemoOrientationLaunch());
  const [open, setOpen] = useState(() => isDemo && !shouldSkipDemoOrientationLaunch());

  const dismiss = () => {
    persistDemoOrientationSkipLaunch(skipLaunch);
    setOpen(false);
  };

  useEffect(() => {
    if (!isDemo) {
      setOpen(false);
      return;
    }

    const shouldSkipLaunch = shouldSkipDemoOrientationLaunch();
    setSkipLaunch(shouldSkipLaunch);
    if (!shouldSkipLaunch) {
      setOpen(true);
    }
  }, [isDemo]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  if (!isDemo) return null;

  return (
    <>
      <button
        onClick={() => {
          setSkipLaunch(shouldSkipDemoOrientationLaunch());
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
        aria-label="Open demo guide"
        title="Open demo guide"
      >
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px]"
          aria-hidden="true"
        >
          ?
        </span>
        <span>Demo Guide</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={dismiss}
        >
          <DemoOrientationPanel
            titleId={titleId}
            skipLaunch={skipLaunch}
            onDismiss={dismiss}
            onSkipLaunchChange={setSkipLaunch}
          />
        </div>
      )}
    </>
  );
}
