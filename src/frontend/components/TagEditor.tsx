import { useState } from 'react';
import type { MergedFileRecord, FileStatus } from '../../shared/types';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  path: string;
  file: MergedFileRecord;
}

const FILE_STATUSES: FileStatus[] = ['active', 'draft', 'deprecated', 'experimental', 'superseded', 'archived'];
export function TagEditor({ path, file }: Props) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showNewFeatureForm, setShowNewFeatureForm] = useState(false);
  const [newFeatureId, setNewFeatureId] = useState('');
  const [newFeatureName, setNewFeatureName] = useState('');
  const [featureError, setFeatureError] = useState('');
  const allTags = useWorkspace(s => s.tags);
  const features = useWorkspace(s => s.features);
  const loadFeatures = useWorkspace(s => s.loadFeatures);
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);

  const suggestions = input.length > 0
    ? allTags.filter(t => t.toLowerCase().includes(input.toLowerCase()) && !file.tags.includes(t))
    : [];

  const addTag = async (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || file.tags.includes(trimmed)) return;
    await api.updateFileMeta(path, { tags: [...file.tags, trimmed] });
    await refreshSelectedFile();
    setInput('');
    setShowSuggestions(false);
  };

  const removeTag = async (tag: string) => {
    await api.updateFileMeta(path, { tags: file.tags.filter(t => t !== tag) });
    await refreshSelectedFile();
  };

  const handleStatus = async (status: string) => {
    await api.updateFileMeta(path, { status });
    await refreshSelectedFile();
  };

  const handleFeatureSelect = async (featureId: string) => {
    if (featureId === '__new__') {
      setShowNewFeatureForm(true);
      return;
    }
    setShowNewFeatureForm(false);
    await api.updateFileMeta(path, { featureId: featureId || undefined });
    await refreshSelectedFile();
  };

  const handleCreateFeature = async () => {
    const id = newFeatureId.trim();
    const name = newFeatureName.trim();
    if (!id || !name) {
      setFeatureError('ID and name are required.');
      return;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      setFeatureError('ID must be kebab-case (e.g. my-feature).');
      return;
    }
    setFeatureError('');
    await api.createFeature(id, { name });
    await loadFeatures();
    await api.updateFileMeta(path, { featureId: id });
    await refreshSelectedFile();
    setShowNewFeatureForm(false);
    setNewFeatureId('');
    setNewFeatureName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) {
        addTag(suggestions[0]);
      } else if (input.trim()) {
        addTag(input);
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Tags + Status + Feature — all on one row */}
      <div className="flex items-start gap-4 flex-wrap">
        {/* Tags */}
        <div className="flex-1 min-w-0">
          <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">Tags</label>
          <div className="flex flex-wrap items-center gap-1">
            {file.tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full
                  bg-forest-800 text-forest-300 border border-forest-700"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="text-forest-500 hover:text-forest-300 ml-0.5"
                  aria-label={`Remove tag ${tag}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <div className="relative inline-block">
              <input
                type="text"
                value={input}
                onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
                onKeyDown={handleKeyDown}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Add tag..."
                className="w-28 px-2 py-1 text-xs rounded bg-surface border border-border
                  text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-36 bg-surface border border-border rounded shadow-lg max-h-32 overflow-y-auto">
                  {suggestions.slice(0, 8).map(s => (
                    <li key={s}>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                        className="w-full text-left px-2 py-1 text-xs text-forest-300 hover:bg-forest-800"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="shrink-0">
          <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">Status</label>
          <select
            value={file.status || ''}
            onChange={e => handleStatus(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-surface border border-border
              text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">none</option>
            {FILE_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Feature */}
        <div className="shrink-0">
          <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">Feature</label>
          <select
            value={showNewFeatureForm ? '__new__' : (file.featureId || '')}
            onChange={e => handleFeatureSelect(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-surface border border-border
              text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">None</option>
            {Object.entries(features).map(([id, feat]) => (
              <option key={id} value={id}>{feat.name} ({id})</option>
            ))}
            <option value="__new__">New feature...</option>
          </select>
        </div>
      </div>

      {/* New feature form (full width below if open) */}
      {showNewFeatureForm && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={newFeatureId}
            onChange={e => setNewFeatureId(e.target.value)}
            placeholder="feature-id (kebab-case)"
            className="w-40 px-2 py-1 text-xs rounded bg-forest-900 border border-forest-700
              text-forest-200 placeholder-forest-500 focus:outline-none focus:border-forest-500"
          />
          <input
            type="text"
            value={newFeatureName}
            onChange={e => setNewFeatureName(e.target.value)}
            placeholder="Feature name"
            className="w-40 px-2 py-1 text-xs rounded bg-forest-900 border border-forest-700
              text-forest-200 placeholder-forest-500 focus:outline-none focus:border-forest-500"
          />
          <button
            onClick={handleCreateFeature}
            className="px-2 py-1 text-xs rounded bg-accent text-on-accent
              hover:bg-accent-hover focus:outline-none"
          >
            Create &amp; assign
          </button>
          <button
            onClick={() => { setShowNewFeatureForm(false); setFeatureError(''); setNewFeatureId(''); setNewFeatureName(''); }}
            className="px-2 py-1 text-xs rounded bg-surface border border-border
              text-text-secondary hover:text-text-primary focus:outline-none"
          >
            Cancel
          </button>
          {featureError && (
            <span className="text-error text-xs">{featureError}</span>
          )}
        </div>
      )}
    </div>
  );
}
