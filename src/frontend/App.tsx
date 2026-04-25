import { FileTree } from './components/FileTree';
import { FileDetail } from './components/FileDetail';
import { DirectoryDetail } from './components/DirectoryDetail';
import { ViewToggle } from './components/ViewToggle';
import { TableView } from './components/TableView';
import { AnalyticsView } from './components/AnalyticsView';
import { AgentBanner } from './components/AgentBanner';
import { CanopyLogo } from './components/CanopyLogo';
import { DemoOrientation } from './components/DemoOrientation';
import { GraphView } from './components/GraphView';
import { Settings } from './components/Settings';
import { WelcomeScreen } from './components/WelcomeScreen';
import { useWorkspace } from './stores/workspace';

export function App() {
  const { connected, repoConfig, loading, error, selectedFile, selectedDirectory, viewMode, saveNotice, agentNotes, disconnect } = useWorkspace();

  // Show welcome screen when not connected to a repo
  if (!connected) {
    return <WelcomeScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-canvas text-text-primary">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="flex items-center gap-2 text-text-primary">
            <CanopyLogo size={22} />
            <span className="font-brand text-base font-bold tracking-[0.01em]">CanopyTag</span>
          </h1>
          {repoConfig && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div
                className="flex min-w-0 items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
                title={repoConfig.repoRoot}
              >
                <span className="font-mono truncate max-w-[200px]">{repoConfig.repoName}</span>
                {repoConfig.isDemo && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-canvas text-text-muted">demo</span>
                )}
              </div>
              <button
                onClick={disconnect}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
                title={`Return to the repo picker.\nCurrent repo: ${repoConfig.repoRoot}`}
                aria-label="Switch repository"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                  <path d="M3 7v10a2 2 0 0 0 2 2h7" />
                  <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v3" />
                  <path d="M14 17h7" />
                  <path d="m18 13 4 4-4 4" />
                </svg>
                <span>Switch Repo</span>
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saveNotice && (
            <span className="text-text-muted text-[10px] font-mono animate-pulse">
              {saveNotice}
            </span>
          )}
          <DemoOrientation isDemo={repoConfig?.isDemo === true} />
          <Settings />
          <ViewToggle />
        </div>
      </header>

      <AgentBanner notes={agentNotes} />

      {loading && <p className="text-text-muted text-sm p-3">Loading...</p>}
      {error && <p className="text-error text-sm p-3">Error: {error}</p>}

      {viewMode === 'table' ? (
        <main className="flex-1 p-3 overflow-hidden">
          <TableView />
        </main>
      ) : viewMode === 'graph' ? (
        <GraphView />
      ) : viewMode === 'analytics' ? (
        <AnalyticsView />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-72 border-r border-border overflow-y-auto flex flex-col">
            <FileTree />
          </aside>
          <main className="flex-1 p-3 overflow-y-auto">
            {!loading && !selectedFile && !selectedDirectory && (
              <p className="text-text-muted text-sm">Select a file or directory to view details</p>
            )}
            {selectedFile && (
              <FileDetail key={selectedFile.path} file={selectedFile} />
            )}
            {selectedDirectory && !selectedFile && (
              <DirectoryDetail key={selectedDirectory.path} directory={selectedDirectory} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
