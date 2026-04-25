import { useState, useEffect } from 'react';
import type { IoMetadata } from '../../shared/types';
import { api } from '../lib/api';
import { useWorkspace } from '../stores/workspace';

interface Props {
  path: string;
  ioMetadata?: IoMetadata;
}

function ItemList({
  label,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const trimmed = input.trim();
    if (trimmed) {
      onAdd(trimmed);
      setInput('');
    }
  };

  return (
    <div>
      <span className="text-text-secondary text-xs uppercase tracking-wider">{label}</span>
      {items.length > 0 && (
        <ul className="mt-1 space-y-1">
          {items.map((item, i) => (
            <li key={`${item}-${i}`} className="flex items-center gap-1 group">
              <span className="text-forest-400 text-xs">-</span>
              <span className="text-text-primary text-xs flex-1">{item}</span>
              <button
                onClick={() => onRemove(i)}
                className="text-forest-700 hover:text-error text-xs opacity-0 group-hover:opacity-100"
                aria-label={`Remove ${label.toLowerCase()} "${item}"`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1 mt-1">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          placeholder={`Add ${label.toLowerCase()}...`}
          className="flex-1 px-2 py-1 text-xs rounded bg-surface border border-border
            text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}

export function IoMetadataEditor({ path, ioMetadata }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [inputs, setInputs] = useState<string[]>(ioMetadata?.inputs ?? []);
  const [outputs, setOutputs] = useState<string[]>(ioMetadata?.outputs ?? []);
  const refreshSelectedFile = useWorkspace(s => s.refreshSelectedFile);

  useEffect(() => {
    setInputs(ioMetadata?.inputs ?? []);
    setOutputs(ioMetadata?.outputs ?? []);
  }, [path, ioMetadata]);

  const hasData = inputs.length > 0 || outputs.length > 0;

  const save = async (newInputs: string[], newOutputs: string[]) => {
    const meta: IoMetadata | undefined =
      newInputs.length > 0 || newOutputs.length > 0
        ? { inputs: newInputs.length > 0 ? newInputs : undefined, outputs: newOutputs.length > 0 ? newOutputs : undefined }
        : undefined;
    await api.updateFileMeta(path, { ioMetadata: meta as any });
    await refreshSelectedFile();
  };

  const addInput = (item: string) => {
    const updated = [...inputs, item];
    setInputs(updated);
    save(updated, outputs);
  };

  const removeInput = (index: number) => {
    const updated = inputs.filter((_, i) => i !== index);
    setInputs(updated);
    save(updated, outputs);
  };

  const addOutput = (item: string) => {
    const updated = [...outputs, item];
    setOutputs(updated);
    save(inputs, updated);
  };

  const removeOutput = (index: number) => {
    const updated = outputs.filter((_, i) => i !== index);
    setOutputs(updated);
    save(inputs, updated);
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-text-primary text-sm uppercase tracking-wider mb-1"
      >
        <span className="text-forest-500 text-xs">{expanded ? '▾' : '▸'}</span>
        I/O Metadata
        {hasData && !expanded && (
          <span className="text-forest-500 font-normal normal-case">
            ({inputs.length} in, {outputs.length} out)
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2 pl-3 border-l border-border">
          <ItemList label="Inputs" items={inputs} onAdd={addInput} onRemove={removeInput} />
          <ItemList label="Outputs" items={outputs} onAdd={addOutput} onRemove={removeOutput} />
        </div>
      )}
    </div>
  );
}
