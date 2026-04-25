import { useState, useRef, useEffect } from 'react';
import { useSettings } from '../stores/settings';
import { useWorkspace } from '../stores/workspace';
import { api } from '../lib/api';

export function Settings() {
  const { theme, fontSize, setTheme, setFontSize } = useSettings();
  const profile = useWorkspace(s => s.profile);
  const loadProfile = useWorkspace(s => s.loadProfile);
  const updateProfile = useWorkspace(s => s.updateProfile);
  const [open, setOpen] = useState(false);
  const [retention, setRetention] = useState<string>('7d');
  const [analyticsEnabled, setAnalyticsEnabled] = useState<boolean>(true);
  const [authorName, setAuthorName] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getSettings().then((s: any) => {
      if (s.archiveRetention) setRetention(s.archiveRetention);
      if (typeof s.analyticsEnabled === 'boolean') setAnalyticsEnabled(s.analyticsEnabled);
    });
    loadProfile();
  }, []);

  useEffect(() => {
    setAuthorName(profile?.currentAuthor.name ?? '');
  }, [profile?.currentAuthor.name]);

  const handleRetentionChange = async (value: string) => {
    setRetention(value);
    await api.updateSettings({ archiveRetention: value });
  };

  const handleAnalyticsToggle = async (enabled: boolean) => {
    setAnalyticsEnabled(enabled);
    await api.updateSettings({ analyticsEnabled: enabled });
  };

  const handleProfileSave = async () => {
    await updateProfile(authorName);
    setProfileSaved(true);
    window.setTimeout(() => setProfileSaved(false), 1800);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded hover:bg-surface-hover transition-colors text-text-secondary hover:text-text-primary"
        aria-label="Settings"
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Settings panel"
          className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border
          bg-surface shadow-lg p-3 space-y-3 z-50">
          <div>
            <label className="text-text-secondary text-sm font-medium block mb-1.5">Local Author</label>
            <div className="flex gap-2">
              <input
                value={authorName}
                onChange={event => setAuthorName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleProfileSave();
                  }
                }}
                placeholder="Git user name"
                className="min-w-0 flex-1 rounded border border-border bg-canvas px-2 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => { void handleProfileSave(); }}
                className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
              >
                Save
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-text-muted">
              Stored in canopytag/profile.local.json and ignored by git.
              {profileSaved && <span className="text-text-secondary"> Saved.</span>}
            </p>
          </div>
          <div>
            <label className="text-text-secondary text-sm font-medium block mb-1.5">Theme</label>
            <div className="flex rounded overflow-hidden border border-border">
              {(['dark', 'light'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    theme === t
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-text-secondary text-sm font-medium block mb-1.5">Font Size</label>
            <div className="flex rounded overflow-hidden border border-border">
              {(['small', 'medium', 'large'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFontSize(s)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                    fontSize === s
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-text-secondary text-sm font-medium block mb-1.5">Auto-archive</label>
            <div className="flex rounded overflow-hidden border border-border">
              {[
                { value: 'off', label: 'Off' },
                { value: '1d', label: '1 day' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
              ].map(opt => (
                <button key={opt.value} onClick={() => handleRetentionChange(opt.value)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
                    retention === opt.value
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface text-text-muted hover:bg-surface-hover'
                  }`}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-text-secondary text-sm font-medium block mb-1.5">Agent Analytics</label>
            <div className="flex rounded overflow-hidden border border-border">
              {[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => handleAnalyticsToggle(opt.value)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    analyticsEnabled === opt.value
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
