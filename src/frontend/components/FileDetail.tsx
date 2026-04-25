import { useState, useEffect } from 'react';
import type { MergedFileRecord } from '../../shared/types';
import { SummaryEditor } from './SummaryEditor';
import { ScoreDisplay, FileDates } from './ScoreDisplay';
import { TagEditor } from './TagEditor';
import { IoMetadataEditor } from './IoMetadataEditor';
import { TodoList } from './TodoList';
import { CommentList } from './CommentList';
import { RelatedFiles } from './RelatedFiles';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  file: MergedFileRecord;
}

function TitleEditor({ path, title }: { path: string; title?: string }) {
  const [value, setValue] = useState(title || '');
  const [editing, setEditing] = useState(false);
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);

  useEffect(() => {
    setValue(title || '');
  }, [path, title]);

  const handleSave = async () => {
    setEditing(false);
    if (value !== (title || '')) {
      await api.updateFileMeta(path, { title: value || undefined });
      await refreshSelectedFile();
    }
  };

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setValue(title || ''); setEditing(false); } }}
        autoFocus
        className="text-forest-100 text-lg font-semibold bg-transparent border-b border-forest-500
          focus:outline-none w-full"
        placeholder="Add a title..."
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-left hover:text-forest-100 transition-colors"
      aria-label={value ? `Edit title: ${value}` : 'Add a title'}
    >
      {value ? (
        <span className="text-forest-100 text-lg font-semibold">{value}</span>
      ) : (
        <span className="text-forest-500 text-lg italic border-b border-dashed border-forest-700">click to add title</span>
      )}
    </button>
  );
}

export function FileDetail({ file }: Props) {
  return (
    <div className="space-y-3">
      {/* Header: path + kind/ext on left, dates on right */}
      <div className="border-b border-border pb-2">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-forest-300 text-sm font-mono truncate">
                {file.path}
              </h2>
              {file.kind && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-forest-800 text-forest-300 border border-forest-700 shrink-0">
                  {file.kind}
                </span>
              )}
              {file.extension && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-forest-900 text-forest-400 border border-forest-700 shrink-0">
                  {file.extension}
                </span>
              )}
            </div>
            <TitleEditor path={file.path} title={file.title} />
          </div>
          <FileDates file={file} />
        </div>
      </div>

      {/* Two-column layout: left (summary, tags, I/O, related) + right (scores) */}
      <div className="grid grid-cols-[1fr,320px] gap-4">
        {/* Left column */}
        <div className="space-y-3 min-w-0">
          <SummaryEditor path={file.path} summary={file.summary} />
          <TagEditor path={file.path} file={file} />
          <IoMetadataEditor path={file.path} ioMetadata={file.ioMetadata} />
          <RelatedFiles files={file.relatedFiles} />
        </div>
        {/* Right column */}
        <div className="space-y-3">
          <ScoreDisplay file={file} />
        </div>
      </div>

      {/* Full width: TODOs + Comments */}
      <TodoList path={file.path} todos={file.todos} />
      <CommentList path={file.path} comments={file.comments} />
    </div>
  );
}
