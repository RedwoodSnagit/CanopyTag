import { useEffect, useMemo, useState } from 'react';
import type {
  Project,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  Task,
  TaskReadiness,
  TaskReadinessState,
  Todo,
} from '../../shared/types';
import { normalizeAuthor } from '../../shared/types';
import { api } from '../lib/api';
import { PRIORITY_COLORS } from '../lib/tokens';

type ProjectFocus = 'current' | ProjectStatus | 'all';

interface ProjectLaneProps {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onOpenGraph: (projectId: string) => void;
  onOpenFile: (path: string) => void;
  onProjectsChanged: () => Promise<void>;
}

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  active: 'border-[var(--color-status-success-border)] bg-[var(--color-status-success-bg)] text-[var(--color-status-success-text)]',
  paused: 'border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]',
  done: 'border-[var(--color-status-neutral-border)] bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]',
};

const FOCUS_LABELS: Record<ProjectFocus, string> = {
  current: 'Current',
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  all: 'All',
};

const READINESS_CLASSES: Record<TaskReadinessState, string> = {
  ready: 'border-[var(--color-status-success-border)] bg-[var(--color-status-success-bg)] text-[var(--color-status-success-text)]',
  blocked: 'border-error/40 bg-error/10 text-error',
  claimed: 'border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]',
  in_progress: 'border-accent/50 bg-accent/10 text-accent',
  done: 'border-[var(--color-status-neutral-border)] bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]',
  deferred: 'border-[var(--color-status-neutral-border)] bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]',
};

function isOpenTodo(todo: Todo): boolean {
  return todo.status === 'open' || todo.status === 'in_progress';
}

function formatAuthor(author: Project['createdBy']): string {
  const signature = normalizeAuthor(author);
  return signature.name ? `${signature.role}:${signature.name}` : signature.role;
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
}

export function removedValues(before: string[] | undefined, after: string[]): string[] {
  const next = new Set(after);
  return (before ?? []).filter(value => !next.has(value));
}

export function filterProjectSummaries(
  projects: ProjectSummary[],
  focus: ProjectFocus,
  search: string,
): ProjectSummary[] {
  const needle = search.trim().toLowerCase();
  return projects.filter(({ project }) => {
    if (focus === 'current' && project.status === 'done') return false;
    if (focus !== 'current' && focus !== 'all' && project.status !== focus) return false;
    if (!needle) return true;
    return [
      project.id,
      project.name,
      project.description,
      ...(project.featureIds ?? []),
      ...(project.files ?? []),
      ...(project.openQuestions ?? []),
      ...(project.milestones ?? []).flatMap(milestone => [milestone.id, milestone.name, milestone.description]),
      ...(project.todos ?? []).flatMap(task => [
        task.id,
        task.text,
        task.whyNow,
        ...(task.ownedPaths ?? []),
        ...(task.resources ?? []).flatMap(resource => [resource.ref, resource.label]),
      ]),
    ].some(value => value?.toLowerCase().includes(needle));
  });
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_CLASSES[status]}`}>
      {status}
    </span>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-surface px-3 py-2">
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
    </div>
  );
}

export function projectTaskCompletionLabel(project: Project, openTodoCount: number): string | null {
  if (project.status === 'done') return 'Project complete';
  if (project.status === 'active' && (project.todos?.length ?? 0) > 0 && openTodoCount === 0) {
    return 'All recorded tasks complete · awaiting next decision';
  }
  return null;
}

function ReadinessBadge({ state }: { state: TaskReadinessState }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${READINESS_CLASSES[state]}`}>
      {state.replace('_', ' ')}
    </span>
  );
}

function hasExecutionPacket(task: Task): boolean {
  return Boolean(
    task.whyNow
    || task.acceptance?.length
    || task.dependencies?.length
    || task.owners?.length
    || task.reviewers?.length
    || task.openQuestions?.length
    || task.ownedPaths?.length
    || task.excludedPaths?.length
    || task.resources?.length
    || task.receipts?.length
    || task.residualRisks?.length
    || task.milestoneId
  );
}

export function ProjectTaskList({
  tasks,
  readiness,
}: {
  tasks: Task[];
  readiness: TaskReadiness[];
}) {
  const readinessByTask = new Map(readiness.map(item => [item.taskId, item]));
  const sorted = [...tasks].sort((a, b) => {
    if (isOpenTodo(a) !== isOpenTodo(b)) return isOpenTodo(a) ? -1 : 1;
    return a.priority - b.priority || a.id.localeCompare(b.id);
  });

  if (sorted.length === 0) {
    return <p className="rounded border border-dashed border-border p-3 text-sm text-text-muted">No project-owned tasks.</p>;
  }

  return (
    <ul className="space-y-2">
      {sorted.map(task => {
        const resolved = readinessByTask.get(task.id);
        const state = resolved?.state ?? (task.status === 'open' ? 'ready' : task.status);
        const readinessBlockers = resolved?.blockers.filter(blocker => blocker.kind !== 'claim') ?? [];
        const activeClaims = resolved?.blockers.filter(blocker => blocker.kind === 'claim') ?? [];
        return (
          <li key={task.id} className="rounded border border-border bg-surface p-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-xs font-bold" style={{ color: PRIORITY_COLORS[task.priority] }}>P{task.priority}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-text-muted">{task.id}</span>
                  <ReadinessBadge state={state} />
                  {task.milestoneId && <span className="text-[10px] text-text-muted">{task.milestoneId}</span>}
                </div>
                <p title={task.text} className={`line-clamp-3 text-sm leading-relaxed ${task.status === 'done' ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                  {task.text}
                </p>
                {task.whyNow && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">Why now: {task.whyNow}</p>}
                {readinessBlockers.length ? (
                  <ul className="mt-2 space-y-1 border-l-2 border-error/50 pl-2 text-xs text-error">
                    {readinessBlockers.map((blocker, index) => <li key={`${blocker.kind}-${blocker.ref ?? index}`}>{blocker.message}</li>)}
                  </ul>
                ) : null}
                {activeClaims.length ? (
                  <ul className="mt-2 space-y-1 border-l-2 border-[var(--color-status-warning-border)] pl-2 text-xs text-[var(--color-status-warning-text)]">
                    {activeClaims.map((claim, index) => <li key={`${claim.kind}-${claim.ref ?? index}`}>{claim.message}</li>)}
                  </ul>
                ) : null}
                {task.tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {task.tags.map(tag => <span key={tag} className="rounded border border-border px-1 py-0.5 text-[9px] text-text-muted">{tag}</span>)}
                  </div>
                ) : null}

                {hasExecutionPacket(task) && (
                  <details className="mt-3 border-t border-border pt-2 text-xs">
                    <summary className="cursor-pointer select-none text-text-secondary hover:text-text-primary">Execution packet</summary>
                    <div className="mt-2 grid gap-3 lg:grid-cols-2">
                      <div className="space-y-2">
                        {task.dependencies?.length ? <div><span className="text-text-muted">Dependencies</span><ul className="mt-1 space-y-1 text-text-primary">{task.dependencies.map((edge, index) => <li key={`${edge.type}-${edge.taskId}-${index}`}><span className="font-mono">{edge.type}</span> {edge.taskId}{edge.reason ? ` — ${edge.reason}` : ''}</li>)}</ul></div> : null}
                        {task.ownedPaths?.length ? <div><span className="text-text-muted">Owned paths</span><p className="mt-1 break-words font-mono text-text-primary">{task.ownedPaths.join(', ')}</p></div> : null}
                        {task.excludedPaths?.length ? <div><span className="text-text-muted">Intentional exclusions</span><p className="mt-1 break-words font-mono text-text-primary">{task.excludedPaths.join(', ')}</p></div> : null}
                        {task.owners?.length ? <div><span className="text-text-muted">Owners</span><p className="mt-1 text-text-primary">{task.owners.map(formatAuthor).join(', ')}</p></div> : null}
                        {task.reviewers?.length ? <div><span className="text-text-muted">Reviewers</span><p className="mt-1 text-text-primary">{task.reviewers.map(formatAuthor).join(', ')}</p></div> : null}
                      </div>
                      <div className="space-y-2">
                        {task.resources?.length ? <div><span className="text-text-muted">Resources</span><ul className="mt-1 space-y-1 text-text-primary">{task.resources.map((resource, index) => <li key={`${resource.kind}-${resource.ref}-${index}`}><span className="font-mono text-text-muted">{resource.role}/{resource.kind}</span> {resource.label ?? resource.ref}</li>)}</ul></div> : null}
                        {task.acceptance?.length ? <div><span className="text-text-muted">Acceptance</span><ul className="mt-1 list-disc space-y-1 pl-4 text-text-primary">{task.acceptance.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
                        {task.openQuestions?.length ? <div><span className="text-text-muted">Required decisions</span><ul className="mt-1 list-disc space-y-1 pl-4 text-text-primary">{task.openQuestions.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
                        {task.receipts?.length ? <div><span className="text-text-muted">Completion receipts</span><ul className="mt-1 space-y-1 text-text-primary">{task.receipts.map(receipt => <li key={receipt.id}><span className="font-mono text-text-muted">{receipt.id}</span> {receipt.kind}/{receipt.outcome} — {receipt.summary}</li>)}</ul></div> : null}
                        {task.residualRisks?.length ? <div><span className="text-text-muted">Residual risks</span><ul className="mt-1 list-disc space-y-1 pl-4 text-text-primary">{task.residualRisks.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectEditForm({
  detail,
  onCancel,
  onSaved,
}: {
  detail: ProjectDetail;
  onCancel: () => void;
  onSaved: (detail: ProjectDetail) => Promise<void>;
}) {
  const { project } = detail;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState(project.status);
  const [questions, setQuestions] = useState((project.openQuestions ?? []).join('\n'));
  const [files, setFiles] = useState((project.files ?? []).join('\n'));
  const [features, setFeatures] = useState((project.featureIds ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const nextFiles = splitList(files);
    const nextFeatures = splitList(features);
    const removedFiles = removedValues(project.files, nextFiles);
    const removedFeatures = removedValues(project.featureIds, nextFeatures);
    if ((removedFiles.length > 0 || removedFeatures.length > 0)
      && !window.confirm(`Remove ${removedFiles.length} file link${removedFiles.length === 1 ? '' : 's'} and ${removedFeatures.length} feature link${removedFeatures.length === 1 ? '' : 's'} from ${project.id}? The files and features themselves will not be deleted.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateProject(project.id, {
        name,
        description,
        status,
        openQuestions: splitList(questions),
        files: nextFiles,
        featureIds: nextFeatures,
        expectedFiles: project.files ?? [],
        expectedFeatureIds: project.featureIds ?? [],
      });
      await onSaved(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded border border-border bg-canvas px-2 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none';
  const labelClass = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-muted';

  return (
    <div className="space-y-3 rounded border border-accent/60 bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr,140px]">
        <label>
          <span className={labelClass}>Name</span>
          <input className={inputClass} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label>
          <span className={labelClass}>Status</span>
          <select className={inputClass} value={status} onChange={event => setStatus(event.target.value as ProjectStatus)}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Done</option>
          </select>
        </label>
      </div>
      <label>
        <span className={labelClass}>Why this project exists</span>
        <textarea className={`${inputClass} min-h-24 resize-y`} value={description} onChange={event => setDescription(event.target.value)} />
      </label>
      <div className="grid gap-3 lg:grid-cols-3">
        <label>
          <span className={labelClass}>Open questions · one per line</span>
          <textarea className={`${inputClass} min-h-32 resize-y font-mono text-xs`} value={questions} onChange={event => setQuestions(event.target.value)} />
        </label>
        <label>
          <span className={labelClass}>Linked files · one per line</span>
          <textarea className={`${inputClass} min-h-32 resize-y font-mono text-xs`} value={files} onChange={event => setFiles(event.target.value)} />
        </label>
        <label>
          <span className={labelClass}>Feature IDs · one per line</span>
          <textarea className={`${inputClass} min-h-32 resize-y font-mono text-xs`} value={features} onChange={event => setFeatures(event.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={() => { void save(); }}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save project'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded border border-border bg-canvas px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
        >
          Cancel
        </button>
        <span className="text-[10px] text-text-muted">Removing relationships requires confirmation; project deletion is not exposed.</span>
      </div>
    </div>
  );
}

function ProjectDetailPanel({
  projectId,
  onOpenGraph,
  onOpenFile,
  onProjectsChanged,
}: {
  projectId: string;
  onOpenGraph: (projectId: string) => void;
  onOpenFile: (path: string) => void;
  onProjectsChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    setSaved(false);
    void api.fetchProject(projectId)
      .then(result => { if (!cancelled) setDetail(result); })
      .catch((err: any) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <p className="p-4 text-sm text-text-muted">Loading project…</p>;
  if (error) return <p className="p-4 text-sm text-error">{error}</p>;
  if (!detail) return null;

  const { project } = detail;
  const completionLabel = projectTaskCompletionLabel(project, detail.openTodoCount);

  const handleSaved = async (updated: ProjectDetail) => {
    setDetail(updated);
    setEditing(false);
    setSaved(true);
    await onProjectsChanged();
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-accent">{project.id}</span>
            <StatusBadge status={project.status} />
            {saved && <span className="text-[10px] text-success">Saved to canopy.json</span>}
          </div>
          <h2 className="text-xl font-semibold text-text-primary">{project.name}</h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-text-secondary">
            {project.description || 'No project outcome has been described yet.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenGraph(project.id)}
            className="rounded border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent"
          >
            View execution graph
          </button>
          <button
            type="button"
            onClick={() => { setEditing(value => !value); setSaved(false); }}
            className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
          >
            {editing ? 'Close editor' : 'Edit project'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mb-4">
          <ProjectEditForm detail={detail} onCancel={() => setEditing(false)} onSaved={handleSaved} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <CountCard label="Linked files" value={detail.files.length} />
        <CountCard label="Open tasks" value={detail.openTodoCount} />
        <CountCard label="Ready" value={detail.taskReadiness.filter(item => item.state === 'ready').length} />
        <CountCard label="Blocked" value={detail.taskReadiness.filter(item => item.state === 'blocked').length} />
        <CountCard label="Claimed" value={detail.taskReadiness.filter(item => item.state === 'claimed').length} />
        <CountCard label="Milestones" value={project.milestones?.length ?? 0} />
      </div>

      {completionLabel && (
        <p className="mb-4 rounded border border-[var(--color-status-success-border)] bg-[var(--color-status-success-bg)] px-3 py-2 text-sm text-[var(--color-status-success-text)]">
          {completionLabel}. The project record stays {project.status} until a human changes its scope or status.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr),minmax(300px,0.8fr)]">
        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Project tasks</h3>
            <ProjectTaskList tasks={project.todos ?? []} readiness={detail.taskReadiness} />
            <p className="mt-2 text-[10px] text-text-muted">Task lifecycle and execution packets remain read-only here until one reviewed file/project mutation contract exists.</p>
          </section>

          {project.milestones?.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Milestones</h3>
              <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
                {project.milestones.map(milestone => (
                  <li key={milestone.id} className="p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-text-primary">{milestone.name}</span>
                      <span className="font-mono text-[10px] text-text-muted">{milestone.completedAt ? 'completed' : milestone.targetAt ?? 'open anchor'}</span>
                    </div>
                    {milestone.description && <p className="mt-1 text-xs leading-relaxed text-text-muted">{milestone.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Linked files</h3>
            {detail.files.length === 0 ? (
              <p className="rounded border border-dashed border-border p-3 text-sm text-text-muted">No linked files.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-surface">
                {detail.files.map(file => (
                  <li key={file.path}>
                    <button type="button" onClick={() => onOpenFile(file.path)} className="w-full px-3 py-2 text-left transition-colors hover:bg-surface-hover">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">{file.path}</span>
                        {!file.annotated && <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[9px] text-text-muted">unannotated</span>}
                      </div>
                      {(file.record.title || file.record.summary) && (
                        <p className="mt-1 line-clamp-2 text-xs text-text-muted">{file.record.title || file.record.summary}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded border border-border bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Open questions</h3>
            {project.openQuestions?.length ? (
              <ul className="space-y-2 text-sm leading-relaxed text-text-primary">
                {project.openQuestions.map(question => <li key={question} className="border-l-2 border-accent pl-2">{question}</li>)}
              </ul>
            ) : <p className="text-sm text-text-muted">No open questions.</p>}
          </section>

          <section className="rounded border border-border bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Context</h3>
            <dl className="space-y-2 text-xs">
              <div><dt className="text-text-muted">Owners</dt><dd className="mt-0.5 text-text-primary">{project.owners?.map(formatAuthor).join(', ') || 'Unassigned'}</dd></div>
              <div><dt className="text-text-muted">Features</dt><dd className="mt-0.5 text-text-primary">{detail.features.map(item => item.feature?.name ? `${item.id} · ${item.feature.name}` : item.id).join(', ') || 'None'}</dd></div>
              <div><dt className="text-text-muted">Created</dt><dd className="mt-0.5 font-mono text-text-primary">{project.createdAt} · {formatAuthor(project.createdBy)}</dd></div>
              {project.completedAt && <div><dt className="text-text-muted">Completed</dt><dd className="mt-0.5 font-mono text-text-primary">{project.completedAt}</dd></div>}
            </dl>
          </section>

          <section className="rounded border border-border bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Recent activity</h3>
            {detail.recentActivity.length ? (
              <ul className="space-y-2">
                {detail.recentActivity.map(entry => (
                  <li key={entry.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2"><span className="font-mono text-text-muted">{entry.id}</span><span className="text-[10px] uppercase text-text-muted">{entry.status}</span></div>
                    <p className="mt-0.5 text-text-primary">{entry.headline ?? entry.kind ?? 'Project activity'}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-text-muted">No project-linked activity yet.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

export function ProjectLane({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenGraph,
  onOpenFile,
  onProjectsChanged,
}: ProjectLaneProps) {
  const [focus, setFocus] = useState<ProjectFocus>('current');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => filterProjectSummaries(projects, focus, search), [focus, projects, search]);
  const selectedId = activeProjectId ?? filtered[0]?.project.id ?? null;
  const focusCounts = useMemo(() => ({
    current: projects.filter(item => item.project.status !== 'done').length,
    active: projects.filter(item => item.project.status === 'active').length,
    paused: projects.filter(item => item.project.status === 'paused').length,
    done: projects.filter(item => item.project.status === 'done').length,
    all: projects.length,
  }), [projects]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(240px,320px),minmax(0,1fr)] overflow-hidden rounded border border-border">
      <aside className="flex min-h-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-3">
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Filter projects…"
            className="mb-2 w-full rounded border border-border bg-canvas px-2 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {(Object.keys(FOCUS_LABELS) as ProjectFocus[]).map(value => (
              <button
                type="button"
                key={value}
                onClick={() => setFocus(value)}
                className={`rounded border px-1.5 py-1 text-[10px] transition-colors ${focus === value ? 'border-accent bg-accent text-on-accent' : 'border-border bg-canvas text-text-muted hover:border-accent hover:text-text-primary'}`}
              >
                {FOCUS_LABELS[value]} {focusCounts[value]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(summary => {
            const { project } = summary;
            const selected = selectedId === project.id;
            return (
              <button
                type="button"
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`w-full border-b border-border px-3 py-3 text-left transition-colors ${selected ? 'bg-surface-hover shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-surface-hover/60'}`}
                aria-current={selected ? 'true' : undefined}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-accent">{project.id}</span>
                  <StatusBadge status={project.status} />
                </div>
                <div className="line-clamp-2 text-sm font-semibold text-text-primary">{project.name}</div>
                <div className="mt-2 flex gap-3 text-[10px] text-text-muted">
                  <span>{summary.readyTaskCount} ready</span>
                  <span>{summary.blockedTaskCount} blocked</span>
                  <span>{summary.fileCount} files</span>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="p-4 text-sm text-text-muted">No projects match this view.</p>}
        </div>
      </aside>

      <main className="min-h-0 bg-canvas">
        {selectedId
          ? <ProjectDetailPanel key={selectedId} projectId={selectedId} onOpenGraph={onOpenGraph} onOpenFile={onOpenFile} onProjectsChanged={onProjectsChanged} />
          : <p className="p-4 text-sm text-text-muted">Select a project to inspect its context.</p>}
      </main>
    </div>
  );
}
