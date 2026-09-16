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
import { PRIORITY_COLORS } from '../lib/tokens';

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

export function ProjectBacklinks({ file }: Props) {
  const openProject = useWorkspace(state => state.openProject);
  if (file.projects.length === 0) return null;

  return (
    <section className="rounded border border-border bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Implicated in</h3>
      <div className="space-y-3">
        {file.projects.map(project => {
          const inherited = project.todos.filter(todo => todo.status === 'open' || todo.status === 'in_progress');
          return (
            <div key={project.id} className="rounded border border-border bg-canvas p-3">
              <button type="button" onClick={() => openProject(project.id)} className="group w-full text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-accent">{project.id}</span>
                    <div className="truncate text-sm font-semibold text-text-primary transition-colors group-hover:text-accent">{project.name}</div>
                  </div>
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">{project.status}</span>
                </div>
                {project.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{project.description}</p>}
              </button>
              {inherited.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">Inherited project TODOs · read-only</div>
                  <ul className="space-y-1.5">
                    {inherited.map(todo => (
                      <li key={todo.id} className="flex items-start gap-2 text-xs text-text-secondary">
                        <span className="mt-0.5 shrink-0 font-bold" style={{ color: PRIORITY_COLORS[todo.priority] }}>P{todo.priority}</span>
                        <span className="line-clamp-2" title={todo.text}>{todo.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
      <ProjectBacklinks file={file} />
      <TodoList path={file.path} todos={file.todos} />
      <CommentList path={file.path} comments={file.comments} />
    </div>
  );
}
