import type { AgentNote } from '../../shared/types';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  notes: AgentNote[];
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function AgentBanner({ notes }: Props) {
  const initialize = useWorkspace(s => s.initialize);
  const unacknowledged = notes.filter(n => !n.acknowledged);

  if (unacknowledged.length === 0) return null;

  const handleAcknowledge = async (index: number) => {
    await api.acknowledgeAgentNote(index);
    await initialize();
  };

  return (
    <div className="border-b border-border bg-surface/50">
      {unacknowledged.map((note, i) => (
        <div key={`${note.createdAt}-${i}`} className="flex items-start gap-2 px-3 py-1.5">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface text-text-secondary shrink-0">
            {note.agent}
          </span>
          <p className="text-xs text-text-secondary flex-1">{note.text}</p>
          <span className="text-[10px] text-forest-600 shrink-0">{formatDate(note.createdAt)}</span>
          <button
            onClick={() => handleAcknowledge(notes.indexOf(note))}
            className="text-forest-600 hover:text-forest-300 text-xs shrink-0"
            aria-label="Acknowledge agent note"
            title="Acknowledge"
          >
            ✓
          </button>
        </div>
      ))}
    </div>
  );
}
