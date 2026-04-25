import { useState } from 'react';
import type { Comment, Author } from '../../shared/types';
import { normalizeAuthor } from '../../shared/types';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  path: string;
  comments: Comment[];
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function authorLabel(author: Author): string {
  const sig = normalizeAuthor(author);
  if (sig.name) return sig.name;
  return sig.role;
}

function authorRole(author: Author): string {
  return normalizeAuthor(author).role;
}

export function CommentList({ path, comments }: Props) {
  const [text, setText] = useState('');
  const [commentType, setCommentType] = useState<string>('note');
  const [confidence, setConfidence] = useState<number | ''>('');
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);
  const currentAuthor = useWorkspace(s => s.profile?.currentAuthor ?? { role: 'human' as const });

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await api.addComment(path, {
      text: trimmed,
      author: currentAuthor,
      type: commentType !== 'note' ? commentType : undefined,
      confidence: confidence || undefined,
    });
    await refreshSelectedFile();
    setText('');
    setCommentType('note');
    setConfidence('');
  };

  const handleDelete = async (commentId: string) => {
    await api.deleteComment(path, commentId);
    await refreshSelectedFile();
  };

  const handleArchive = async (commentId: string) => {
    await api.archiveItem(path, 'comment', commentId);
    await refreshSelectedFile();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">
        Comments {comments.length > 0 && <span className="text-text-muted">({comments.length})</span>}
      </label>

      {comments.length > 0 && (
        <ul className="space-y-2 mb-2">
          {comments.map((comment, i) => {
            const role = authorRole(comment.author);
            const label = authorLabel(comment.author);
            return (
              <li key={`${comment.createdAt}-${i}`} className="bg-surface rounded p-2 group">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      role === 'human'
                        ? 'bg-forest-700 text-forest-300'
                        : 'bg-forest-800 text-forest-400'
                    }`}>
                      {label}
                    </span>
                    {comment.type && comment.type !== 'note' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${
                        comment.type === 'finding' ? 'bg-forest-800 text-forest-300 border-forest-600' :
                        comment.type === 'bug' ? 'bg-error-muted text-error-text border-error' :
                        'bg-forest-700 text-forest-200 border-forest-600'
                      }`}>{comment.type}</span>
                    )}
                    {comment.confidence && (
                      <span className="text-xs text-forest-500">C:{comment.confidence}</span>
                    )}
                    <span className="text-forest-500 text-xs">{formatDate(comment.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleArchive(comment.id!)}
                      className="text-forest-700 hover:text-forest-400 text-xs"
                      aria-label="Archive comment"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="5" rx="1" />
                        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                        <path d="M10 12h4" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(comment.id!)}
                      className="text-forest-700 hover:text-error text-xs"
                      aria-label="Delete comment"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{comment.text}</p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add form */}
      <div className="space-y-1">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Add comment... (Ctrl+Enter to submit)"
          className="w-full px-2 py-1.5 text-xs rounded bg-surface border border-border
            text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none"
        />
        <div className="flex items-center gap-2 mt-1">
          <select value={commentType} onChange={e => setCommentType(e.target.value)}
            className="bg-surface text-text-primary border border-border rounded px-1 py-1 text-xs">
            <option value="note">Note</option>
            <option value="finding">Finding</option>
            <option value="bug">Bug</option>
            <option value="improvement">Improvement</option>
          </select>
          <select value={confidence} onChange={e => setConfidence(e.target.value ? Number(e.target.value) : '')}
            className="bg-surface text-text-primary border border-border rounded px-1 py-1 text-xs">
            <option value="">Confidence</option>
            {[1, 2, 3, 4, 5].map(c => <option key={c} value={c}>C:{c}</option>)}
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={!text.trim()}
          className="px-2 py-1 text-xs rounded bg-accent text-on-accent hover:bg-accent-hover
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add Comment
        </button>
      </div>
    </div>
  );
}
