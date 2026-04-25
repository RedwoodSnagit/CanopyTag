import { useWorkspace } from '../stores/workspace';
import type { ViewMode } from '../../shared/types';

export function ViewToggle() {
  const { viewMode, setViewMode } = useWorkspace();

  const modes: { value: ViewMode; label: string }[] = [
    { value: 'explorer', label: 'Explorer' },
    { value: 'table', label: 'Table' },
    { value: 'graph', label: 'Graph' },
    { value: 'analytics', label: 'Analytics' },
  ];

  return (
    <div className="flex rounded overflow-hidden border border-border">
      {modes.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setViewMode(value)}
          aria-current={viewMode === value ? 'true' : undefined}
          className={`px-3 py-1 text-xs font-medium transition-colors
            ${viewMode === value
              ? 'bg-accent text-on-accent'
              : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text-secondary'
            }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
