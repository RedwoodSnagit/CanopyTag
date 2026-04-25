import { useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import type { FileRelation, RelationType } from '../../shared/types';
import { CLOSENESS_BG } from '../lib/tokens';

interface Props {
  files: FileRelation[];
}

const RELATION_LABELS: Record<RelationType, string> = {
  'doc-for': 'doc',
  'test-of': 'test',
  'implements': 'impl',
  'procedure-for': 'proc',
  'audit-of': 'audit',
  'update-on': 'log',
  'fed-by': 'input',
};


export function RelatedFiles({ files }: Props) {
  const [open, setOpen] = useState(false);
  const selectFile = useWorkspace(s => s.selectFile);

  if (files.length === 0) return null;

  // Sort by closeness descending
  const sorted = [...files].sort((a, b) => (b.closeness ?? 3) - (a.closeness ?? 3));

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-forest-200 text-sm uppercase tracking-wider flex items-center gap-1 hover:text-forest-100"
      >
        <span className="text-forest-500">{open ? '▾' : '▸'}</span>
        Related Files ({files.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1 ml-3">
          {sorted.map(f => (
            <li key={f.path} className="flex items-center gap-2">
              {/* Closeness dot */}
              <span
                className={`inline-block w-2 h-2 rounded-full ${CLOSENESS_BG[f.closeness ?? 3] ?? CLOSENESS_BG[3]}`}
                title={`Closeness: ${f.closeness ?? 3}/5`}
              />
              {/* Relation type badge */}
              {f.relation && (
                <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-forest-800/60 text-forest-300">
                  {RELATION_LABELS[f.relation] ?? f.relation}
                </span>
              )}
              {/* File path link */}
              <button
                onClick={() => selectFile(f.path)}
                className="text-sm text-forest-400 hover:text-forest-200 font-mono hover:underline text-left truncate"
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
