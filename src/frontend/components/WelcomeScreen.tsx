import { useState, useEffect } from 'react';
import { CanopyLogo } from './CanopyLogo';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface BrowseResult {
  path: string;
  parent: string;
  dirs: string[];
  isGitRepo: boolean;
  hasCanopytag: boolean;
}

function FolderBrowser({ onSelect }: { onSelect: (path: string) => void }) {
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDir = async (dirPath?: string) => {
    setLoading(true);
    try {
      const result = await api.browse(dirPath);
      setBrowse(result);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { loadDir(); }, []);

  if (!browse) return loading ? <p className="text-forest-500 text-sm">Loading...</p> : null;

  return (
    <div className="text-left bg-surface border border-border rounded-lg overflow-hidden max-w-lg mx-auto">
      {/* Current path header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-hover border-b border-border">
        <span className="text-xs font-mono text-text-secondary truncate">{browse.path}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {browse.isGitRepo && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-700 text-forest-300">git</span>
          )}
          {browse.hasCanopytag && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-600 text-forest-200">canopytag</span>
          )}
          <button
            onClick={() => onSelect(browse.path)}
            className="text-xs px-3 py-1 rounded bg-forest-600 text-forest-100 hover:bg-forest-500 transition-colors font-medium"
          >
            Select
          </button>
        </div>
      </div>

      {/* Directory listing */}
      <div className="max-h-48 overflow-y-auto">
        {/* Go up */}
        {browse.parent !== browse.path && (
          <button
            onClick={() => loadDir(browse.parent)}
            className="w-full text-left px-3 py-1.5 text-sm text-forest-400 hover:bg-forest-800 hover:text-forest-200 transition-colors flex items-center gap-2"
          >
            <span className="text-forest-500">..</span>
            <span className="text-xs text-forest-600">up</span>
          </button>
        )}
        {loading ? (
          <p className="text-forest-500 text-xs px-3 py-2">Loading...</p>
        ) : browse.dirs.length === 0 ? (
          <p className="text-forest-600 text-xs px-3 py-2">No subdirectories</p>
        ) : (
          browse.dirs.map(dir => (
            <button
              key={dir}
              onClick={() => loadDir(browse.path + '/' + dir)}
              className="w-full text-left px-3 py-1.5 text-sm text-forest-200 hover:bg-forest-800 transition-colors flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-forest-500 shrink-0">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              {dir}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function WelcomeScreen() {
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const initialize = useWorkspace(s => s.initialize);
  const setRepoConfig = useWorkspace(s => s.setRepoConfig);

  const handleConnect = async (pathOverride?: string) => {
    const target = pathOverride || repoPath.trim();
    if (!target) {
      setError('Please enter a path');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const config = await api.setRepoRoot(target);
      setRepoConfig(config);
      await initialize();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      setConnecting(false);
    }
  };

  const handleDemo = async () => {
    setConnecting(true);
    try {
      const config = await api.getConfig();
      setRepoConfig(config);
      await initialize();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load demo');
      setConnecting(false);
    }
  };

  const handleBrowseSelect = (path: string) => {
    setRepoPath(path);
    setShowBrowser(false);
    setShowInput(true);
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-canvas text-text-primary p-8">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Logo and title */}
        <div className="flex flex-col items-center gap-3">
          <CanopyLogo size={72} />
          <h1 className="font-brand text-3xl font-extrabold tracking-tight text-text-primary">CanopyTag</h1>
          <p className="text-text-secondary text-lg max-w-md">
            Tag, rate, and annotate files in any repository.
            Help agents and humans understand your codebase.
          </p>
        </div>

        {/* Two big cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
          {/* Connect to Repo */}
          <button
            onClick={() => setShowInput(true)}
            className="group flex flex-col items-center gap-4 p-8 rounded-xl
              bg-surface border-2 border-border
              hover:border-accent hover:bg-surface-hover
              transition-all cursor-pointer text-left"
          >
            <div className="w-16 h-16 rounded-full bg-surface group-hover:bg-surface-hover
              flex items-center justify-center transition-colors">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-secondary">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-text-primary">Connect to Repo</h2>
              <p className="text-sm text-text-secondary mt-1">
                Point CanopyTag at any folder to start annotating
              </p>
            </div>
          </button>

          {/* Demo / Tutorial */}
          <button
            onClick={handleDemo}
            disabled={connecting}
            className="group flex flex-col items-center gap-4 p-8 rounded-xl
              bg-surface border-2 border-border
              hover:border-accent hover:bg-surface-hover
              transition-all cursor-pointer text-left
              disabled:opacity-50 disabled:cursor-wait"
          >
            <div className="w-16 h-16 rounded-full bg-surface group-hover:bg-surface-hover
              flex items-center justify-center transition-colors">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-secondary">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-text-primary">Try the Demo</h2>
              <p className="text-sm text-text-secondary mt-1">
                Explore a sample project to see how CanopyTag works
              </p>
            </div>
          </button>
        </div>

        {/* Repo path input + browse (shown after clicking Connect) */}
        {showInput && !showBrowser && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={repoPath}
                onChange={e => setRepoPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
                placeholder="/path/to/your/repo"
                autoFocus
                className="flex-1 px-4 py-3 rounded-lg bg-surface border border-border
                  text-text-primary placeholder-text-muted
                  focus:outline-none focus:border-accent text-sm font-mono"
              />
              <button
                onClick={() => setShowBrowser(true)}
                className="px-4 py-3 rounded-lg bg-surface text-text-secondary border border-border
                  hover:bg-surface-hover hover:text-text-primary transition-colors"
                aria-label="Browse folders"
                title="Browse folders"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button
                onClick={() => handleConnect()}
                disabled={connecting}
                className="px-6 py-3 rounded-lg bg-accent text-on-accent font-medium
                  hover:bg-accent-hover transition-colors
                  disabled:opacity-50 disabled:cursor-wait"
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            <button
              onClick={() => { setShowInput(false); setShowBrowser(false); setError(''); }}
              className="text-forest-500 text-sm hover:text-forest-300"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Folder browser */}
        {showBrowser && (
          <div className="mt-4 space-y-3">
            <FolderBrowser onSelect={handleBrowseSelect} />
            <button
              onClick={() => setShowBrowser(false)}
              className="text-forest-500 text-sm hover:text-forest-300"
            >
              Back to text input
            </button>
          </div>
        )}

        {error && (
          <p className="text-error text-sm">{error}</p>
        )}
      </div>
    </div>
  );
}
