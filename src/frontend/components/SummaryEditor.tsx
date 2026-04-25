import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  path: string;
  summary?: string;
}

export function SummaryEditor({ path, summary }: Props) {
  const [value, setValue] = useState(summary || '');
  const [saved, setSaved] = useState(false);
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);

  // Sync state when path/summary changes (handles file selection changes
  // without requiring full remount)
  useEffect(() => {
    setValue(summary || '');
  }, [path, summary]);

  const handleSave = async () => {
    if (value !== (summary || '')) {
      await api.updateFileMeta(path, { summary: value });
      await refreshSelectedFile();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  return (
    <div>
      <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">
        Summary {saved && <span className="text-text-secondary">saved</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        rows={3}
        className="w-full px-2 py-1.5 text-sm rounded bg-surface border border-border
          text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none"
        placeholder="Add a summary..."
      />
    </div>
  );
}
