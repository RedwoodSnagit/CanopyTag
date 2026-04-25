import { useState } from 'react';
import type { Todo, Priority, TodoStatus } from '../../shared/types';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';
import { PRIORITY_COLORS } from '../lib/tokens';

interface Props {
  path: string;
  todos: Todo[];
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className="text-xs font-bold px-1.5 py-0.5 rounded"
      style={{ color: PRIORITY_COLORS[priority], borderColor: PRIORITY_COLORS[priority], border: '1px solid' }}
    >
      P{priority}
    </span>
  );
}

function TodoTagBadge({ tag }: { tag: string }) {
  return (
    <span className="text-[10px] px-1 py-0.5 rounded bg-forest-800 text-forest-400 border border-forest-700">
      {tag}
    </span>
  );
}

export function TodoList({ path, todos }: Props) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<Priority>(3);
  const [difficulty, setDifficulty] = useState<number | ''>('');
  const [tagInput, setTagInput] = useState('');
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);
  const currentAuthor = useWorkspace(s => s.profile?.currentAuthor ?? { role: 'human' as const });

  const handleToggle = async (todo: Todo) => {
    const newStatus: TodoStatus = todo.status === 'done' ? 'open' : 'done';
    await api.updateTodo(path, todo.id, { status: newStatus });
    await refreshSelectedFile();
  };

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await api.addTodo(path, {
      text: trimmed,
      priority,
      tags: pendingTags.length > 0 ? pendingTags : undefined,
      createdBy: currentAuthor,
      difficulty: difficulty || undefined,
    });
    await refreshSelectedFile();
    setText('');
    setPriority(3);
    setDifficulty('');
    setPendingTags([]);
    setTagInput('');
  };

  const handleDelete = async (todoId: string) => {
    await api.deleteTodo(path, todoId);
    await refreshSelectedFile();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = tagInput.trim().toLowerCase();
      if (tag && !pendingTags.includes(tag)) {
        setPendingTags([...pendingTags, tag]);
      }
      setTagInput('');
    }
    if (e.key === 'Backspace' && tagInput === '' && pendingTags.length > 0) {
      setPendingTags(pendingTags.slice(0, -1));
    }
  };

  const removePendingTag = (tag: string) => {
    setPendingTags(pendingTags.filter(t => t !== tag));
  };

  const sortedTodos = [...todos].sort((a, b) => {
    // Open items first, then by priority
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return a.priority - b.priority;
  });

  return (
    <div>
      <label className="text-text-primary text-sm uppercase tracking-wider block mb-1">
        TODOs {todos.length > 0 && <span className="text-text-muted">({todos.filter(t => t.status !== 'done').length} open)</span>}
      </label>

      {sortedTodos.length > 0 && (
        <ul className="space-y-1 mb-2">
          {sortedTodos.map(todo => (
            <li key={todo.id} className="flex items-start gap-2 group">
              <input
                type="checkbox"
                checked={todo.status === 'done'}
                onChange={() => handleToggle(todo)}
                className="accent-forest-500 w-4 h-4 cursor-pointer mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${todo.status === 'done' ? 'line-through text-forest-600' : 'text-forest-200'}`}>
                  {todo.text}
                </span>
                {todo.tags && todo.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {todo.tags.map(tag => (
                      <TodoTagBadge key={tag} tag={tag} />
                    ))}
                  </div>
                )}
              </div>
              <PriorityBadge priority={todo.priority} />
              {todo.difficulty && (
                <span className="text-xs px-1 py-0.5 rounded bg-forest-800 text-forest-400 border border-forest-700">
                  D{todo.difficulty}
                </span>
              )}
              <button
                onClick={() => handleDelete(todo.id)}
                className="text-forest-700 hover:text-error text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete todo"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add todo..."
            className="flex-1 px-2 py-1 text-xs rounded bg-surface border border-border
              text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
          />
          <select
            value={priority}
            onChange={e => setPriority(Number(e.target.value) as Priority)}
            className="px-1 py-1 text-xs rounded bg-surface border border-border
              text-text-primary focus:outline-none focus:border-accent"
          >
            {([1, 2, 3, 4, 5] as Priority[]).map(p => (
              <option key={p} value={p}>P{p}</option>
            ))}
          </select>
          <select value={difficulty} onChange={e => setDifficulty(e.target.value ? Number(e.target.value) : '')}
            className="bg-surface text-text-primary border border-border rounded px-1 py-1 text-xs">
            <option value="">D-</option>
            {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={!text.trim()}
            className="px-2 py-1 text-xs rounded bg-accent text-on-accent hover:bg-accent-hover
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
        {/* Tag input for new todo */}
        <div className="flex items-center gap-1 flex-wrap">
          {pendingTags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-forest-800 text-forest-400 border border-forest-700">
              {tag}
              <button onClick={() => removePendingTag(tag)} className="text-forest-600 hover:text-forest-300" aria-label={`Remove tag ${tag}`}>&times;</button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder={pendingTags.length > 0 ? 'more tags...' : 'tags (enter/comma to add)'}
            className="flex-1 min-w-[100px] px-1 py-0.5 text-xs rounded bg-transparent border-none
              text-forest-400 placeholder-forest-600 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
