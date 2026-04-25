import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  directory: {
    path: string;
    summary?: string;
    fileCount: number;
    openTodoCount: number;
  };
}

export function DirectoryDetail({ directory }: Props) {
  const [summary, setSummary] = useState(directory.summary || '');
  const [saved, setSaved] = useState(false);
  const flashSave = useWorkspace(s => s.flashSave);

  useEffect(() => {
    setSummary(directory.summary || '');
  }, [directory.path, directory.summary]);

  const handleSave = async () => {
    if (summary !== (directory.summary || '')) {
      await api.updateDirectorySummary(directory.path, summary);
      flashSave(directory.path);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  return (
    <div className="space-y-4">
      {/* Path header */}
      <div className="border-b border-border pb-2 flex items-center justify-between">
        <h2 className="text-text-primary text-sm font-mono">
          {directory.path}/
        </h2>
        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-forest-800 text-forest-300 border border-forest-700">
          directory
        </span>
      </div>

      {/* Summary */}
      <div>
        <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">
          Summary {saved && <span className="text-forest-400">saved</span>}
        </label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={handleSave}
          rows={3}
          className="w-full px-2 py-1.5 text-sm rounded bg-surface border border-border
            text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none"
          placeholder="Describe what this directory contains..."
        />
      </div>

      {/* Stats */}
      <div className="flex gap-6">
        <div>
          <span className="text-text-primary text-sm uppercase tracking-wider block mb-1">Files</span>
          <span className="text-text-primary text-lg font-semibold">{directory.fileCount}</span>
        </div>
        <div>
          <span className="text-text-primary text-sm uppercase tracking-wider block mb-1">Open TODOs</span>
          <span className="text-text-primary text-lg font-semibold">{directory.openTodoCount}</span>
        </div>
      </div>

      {/* Design note */}
      <div className="mt-6 p-3 rounded bg-surface/50 border border-border">
        <p className="text-forest-500 text-xs leading-relaxed">
          <span className="text-forest-400 font-semibold">Why summary only?</span>{' '}
          Tags, TODOs, scores, and features belong on individual files where they are
          specific and actionable. Directory summaries provide orientation context without
          duplicating file-level metadata. This keeps the agent read path flat and efficient
          — agents only need to scan the <span className="font-mono text-forest-400">files</span> section
          of canopy.json, not resolve inheritance from directory hierarchies.
        </p>
      </div>
    </div>
  );
}
