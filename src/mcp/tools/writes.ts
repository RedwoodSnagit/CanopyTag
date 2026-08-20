import { readCanopy, writeCanopy, nextTodoId, nextCommentId, nextProjectId } from '../../backend/lib/canopy.js';
import {
  appendAgentManifestEntry,
  nextManifestEntryId,
  readAgentManifest,
  resolveAgentManifestPathFromCanopyPath,
  writeAgentManifest,
} from '../../backend/lib/agent-manifest.js';
import type {
  AgentManifestEntry,
  Author,
  AuthorSignature,
  Comment,
  FileCanopy,
  Project,
  Todo,
} from '../../shared/types.js';
import { UNATTRIBUTED_AGENT_NAME, isUnattributedAgentName } from '../../shared/types.js';
import { collectTags, levenshtein, normalizeSeparators } from './tags.js';

export interface AgentAttributionParams {
  agent_name?: string;
  agent_session?: string;
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveAgentAuthor(params: AgentAttributionParams = {}): AuthorSignature {
  const candidate =
    cleanEnv(params.agent_name) ??
    cleanEnv(process.env.CANOPYTAG_AGENT_NAME) ??
    cleanEnv(process.env.MCP_CLIENT_NAME);
  // A role word is not a model identity. Recording "agent" as a name makes a
  // missing attribution look like a real one, which is how every entry in a
  // long-running repo ends up anonymous without anyone noticing. Mark the gap
  // explicitly instead; `canopytag doctor` reports it.
  const name = isUnattributedAgentName(candidate) ? UNATTRIBUTED_AGENT_NAME : candidate!;
  const session =
    cleanEnv(params.agent_session) ??
    cleanEnv(process.env.CANOPYTAG_AGENT_SESSION);

  return {
    role: 'agent',
    name,
    ...(session ? { session } : {}),
  };
}

function cloneValue<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function resolveProject(canopy: ReturnType<typeof readCanopy>, ref: string): [string, Project] {
  const matches = Object.entries(canopy.projects ?? {}).filter(([key, project]) =>
    key === ref || project.id === ref || project.name.toLowerCase() === ref.toLowerCase()
  );
  if (matches.length === 0) throw new Error(`Project not found: ${ref}`);
  if (matches.length > 1) throw new Error(`Project reference is ambiguous: ${ref}`);
  return matches[0];
}

export function handleAddProject(canopyPath: string, params: {
  id?: string;
  name: string;
  description?: string;
  status?: Project['status'];
  owners?: Author[];
  feature_ids?: string[];
  files?: string[];
  open_questions?: string[];
} & AgentAttributionParams): string {
  const name = params.name.trim();
  if (!name) throw new Error('Project name cannot be empty.');

  const author = resolveAgentAuthor(params);
  const canopy = readCanopy(canopyPath);
  if (!canopy.projects) canopy.projects = {};
  const id = params.id?.trim() || nextProjectId(canopy);
  if (!/^PRJ-\d+$/.test(id)) throw new Error('Project ID must use the form PRJ-001.');
  if (canopy.projects[id] || Object.values(canopy.projects).some(project => project.id === id)) {
    throw new Error(`Project already exists: ${id}`);
  }
  if (Object.values(canopy.projects).some(project => project.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name already exists: ${name}`);
  }

  const now = new Date().toISOString();
  const project: Project = {
    id,
    name,
    description: params.description?.trim() || undefined,
    status: params.status ?? 'active',
    owners: params.owners?.length ? cloneValue(params.owners) : undefined,
    featureIds: params.feature_ids?.length ? [...params.feature_ids] : undefined,
    files: params.files?.length ? [...params.files] : undefined,
    openQuestions: params.open_questions?.length ? [...params.open_questions] : undefined,
    createdAt: now,
    createdBy: author,
    completedAt: params.status === 'done' ? now : undefined,
  };
  canopy.projects[id] = project;
  writeCanopy(canopyPath, canopy);

  const manifestPath = resolveAgentManifestPathFromCanopyPath(canopyPath);
  appendAgentManifestEntry(manifestPath, manifest => ({
    id: nextManifestEntryId(manifest),
    projectId: id,
    createdAt: now,
    author,
    status: 'pending',
    kind: 'project-create',
    headline: `Created project ${id}: ${name}`,
    fields: ['projects'],
    applied: true,
    canReject: true,
    undo: { type: 'project-create', projectId: id, project: cloneValue(project) },
  }));
  return `Created project ${id}: ${name}`;
}

export function handleUpdateProject(canopyPath: string, params: {
  project: string;
  name?: string;
  description?: string;
  status?: Project['status'];
  owners?: Author[];
  feature_ids?: string[];
  files?: string[];
  open_questions?: string[];
} & AgentAttributionParams): string {
  const author = resolveAgentAuthor(params);
  const canopy = readCanopy(canopyPath);
  const [projectKey, project] = resolveProject(canopy, params.project);
  const before: Partial<Project> = {};
  const changed: Array<keyof Project> = [];

  const replace = <K extends keyof Project>(field: K, value: Project[K] | undefined): void => {
    before[field] = cloneValue(project[field]) as any;
    if (value === undefined) delete (project as any)[field];
    else (project as any)[field] = cloneValue(value);
    changed.push(field);
  };

  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) throw new Error('Project name cannot be empty.');
    const duplicate = Object.entries(canopy.projects ?? {}).some(([key, candidate]) =>
      key !== projectKey && candidate.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) throw new Error(`Project name already exists: ${name}`);
    replace('name', name);
  }
  if (params.description !== undefined) replace('description', params.description.trim() || undefined);
  if (params.owners !== undefined) replace('owners', params.owners.length ? params.owners : undefined);
  if (params.feature_ids !== undefined) replace('featureIds', params.feature_ids.length ? params.feature_ids : undefined);
  if (params.files !== undefined) replace('files', params.files.length ? params.files : undefined);
  if (params.open_questions !== undefined) replace('openQuestions', params.open_questions.length ? params.open_questions : undefined);
  if (params.status !== undefined && params.status !== project.status) {
    replace('status', params.status);
    replace('completedAt', params.status === 'done' ? new Date().toISOString() : undefined);
  }
  if (changed.length === 0) throw new Error('Provide at least one project field to update.');

  const after: Partial<Project> = {};
  for (const field of changed) (after as any)[field] = cloneValue(project[field]);
  writeCanopy(canopyPath, canopy);

  const manifestPath = resolveAgentManifestPathFromCanopyPath(canopyPath);
  appendAgentManifestEntry(manifestPath, manifest => ({
    id: nextManifestEntryId(manifest),
    projectId: project.id,
    createdAt: new Date().toISOString(),
    author,
    status: 'pending',
    kind: 'project-update',
    headline: `Updated project ${project.id}: ${changed.join(', ')}`,
    fields: changed.map(String),
    applied: true,
    canReject: true,
    undo: {
      type: 'project-update',
      projectId: projectKey,
      before,
      after,
    },
  }));
  return `Updated project ${project.id}: ${changed.join(', ')}`;
}

/**
 * Returns a warning string if any of the given tags are new to the vocabulary.
 * Shows fuzzy matches (separator-normalized or Levenshtein <=2) from existing tags.
 * Returns empty string if all tags are known or vocab is empty.
 * vocab should be collected BEFORE the write so new tags are not in it yet.
 */
function warnNewTagsWithVocab(vocab: Map<string, number>, incomingTags: string[]): string {
  if (incomingTags.length === 0 || vocab.size === 0) return '';

  const newTags = incomingTags.filter(t => !vocab.has(t));
  if (newTags.length === 0) return '';

  const vocabNames = [...vocab.keys()];
  const warnings: string[] = [];

  for (const tag of newTags) {
    const similar = vocabNames.filter(v => {
      if (normalizeSeparators(v) === normalizeSeparators(tag)) return true;
      if (levenshtein(v.toLowerCase(), tag.toLowerCase()) <= 2) return true;
      return false;
    });

    if (similar.length > 0) {
      const matches = similar
        .sort((a, b) => (vocab.get(b) ?? 0) - (vocab.get(a) ?? 0))
        .slice(0, 3)
        .map(s => `\`${s}\` (${vocab.get(s)} file${vocab.get(s) !== 1 ? 's' : ''})`)
        .join(', ');
      warnings.push(`\`${tag}\` is new — similar: ${matches}`);
    } else {
      warnings.push(`\`${tag}\` is new to this repo's tag vocabulary`);
    }
  }

  if (warnings.length === 0) return '';
  return '\n\nTag note: ' + warnings.join('; ') + '. Use canopytag_tags to browse vocabulary, canopytag_tags health=true for hygiene, or canopytag_rename_tag to consolidate.';
}

export function handleAddComment(canopyPath: string, params: {
  file: string; text: string; type?: string; confidence?: number;
} & AgentAttributionParams): string {
  const author = resolveAgentAuthor(params);
  const manifestPath = resolveAgentManifestPathFromCanopyPath(canopyPath);
  const canopy = readCanopy(canopyPath);
  if (!canopy.files[params.file]) {
    canopy.files[params.file] = { comments: [] } as any;
  }
  const file = canopy.files[params.file];
  if (!file.comments) file.comments = [];

  const id = nextCommentId(canopy);
  const comment: Comment = {
    id,
    text: params.text,
    author,
    createdAt: new Date().toISOString(),
    type: (params.type as any) ?? 'note',
    confidence: params.confidence as any,
  };
  file.comments.push(comment);
  writeCanopy(canopyPath, canopy);
  appendAgentManifestEntry(manifestPath, (manifest) => ({
    id: nextManifestEntryId(manifest),
    file: params.file,
    createdAt: comment.createdAt,
    author,
    status: 'pending',
    kind: 'comment',
    headline: `Added ${comment.type ?? 'note'} comment`,
    fields: ['comments'],
    applied: true,
    canReject: true,
    comment: comment.text,
    undo: {
      type: 'comment',
      commentId: comment.id!,
      comment: cloneValue(comment),
    },
  }));
  return `Added comment ${id} to ${params.file}`;
}

export function handleAnnotate(canopyPath: string, params: {
  file: string; summary?: string; tags?: string[];
  authority_level?: string; status?: string; feature_id?: string;
  validity?: number; clarity?: number; completeness?: number; stability?: number;
} & AgentAttributionParams): string {
  const author = resolveAgentAuthor(params);
  const manifestPath = resolveAgentManifestPathFromCanopyPath(canopyPath);
  const canopy = readCanopy(canopyPath);
  let fc = canopy.files[params.file];

  if (fc?.locked) {
    throw new Error(`File is locked: ${params.file}. Use add_comment to leave observations.`);
  }

  if (!fc) {
    fc = {} as FileCanopy;
    canopy.files[params.file] = fc;
  }

  // Collect vocab before writing so we can detect new tags
  const vocabBefore = params.tags !== undefined ? collectTags(canopy) : null;
  const beforeSnapshot: Partial<FileCanopy> = {};

  const updated: string[] = [];
  if (params.summary !== undefined) { beforeSnapshot.summary = cloneValue(fc.summary); fc.summary = params.summary; updated.push('summary'); }
  if (params.tags !== undefined) { beforeSnapshot.tags = cloneValue(fc.tags); fc.tags = params.tags; updated.push('tags'); }
  if (params.authority_level !== undefined) { beforeSnapshot.authorityLevel = cloneValue(fc.authorityLevel); fc.authorityLevel = params.authority_level as any; updated.push('authorityLevel'); }
  if (params.status !== undefined) { beforeSnapshot.status = cloneValue(fc.status); fc.status = params.status as any; updated.push('status'); }
  if (params.feature_id !== undefined) { beforeSnapshot.featureId = cloneValue(fc.featureId); fc.featureId = params.feature_id; updated.push('featureId'); }

  const scoreFields = ['validity', 'clarity', 'completeness', 'stability'] as const;
  let scoresChanged = false;
  for (const field of scoreFields) {
    if (params[field] !== undefined) {
      (beforeSnapshot as any)[field] = cloneValue((fc as any)[field]);
      (fc as any)[field] = params[field];
      updated.push(field);
      scoresChanged = true;
    }
  }
  if (scoresChanged) {
    beforeSnapshot.scoresReviewed = cloneValue(fc.scoresReviewed);
    fc.scoresReviewed = false;
    updated.push('scoresReviewed');
  }

  writeCanopy(canopyPath, canopy);
  if (updated.length > 0) {
    const afterSnapshot: Partial<FileCanopy> = {};
    for (const field of updated) {
      (afterSnapshot as any)[field] = cloneValue((fc as any)[field]);
    }
    appendAgentManifestEntry(manifestPath, (manifest) => ({
      id: nextManifestEntryId(manifest),
      file: params.file,
      createdAt: new Date().toISOString(),
      author,
      status: 'pending',
      kind: 'annotate',
      headline: `Updated metadata: ${updated.join(', ')}`,
      fields: [...updated],
      applied: true,
      canReject: true,
      proposal: {
        summary: params.summary,
        tags: params.tags,
        authorityLevel: params.authority_level as any,
        fileStatus: params.status as any,
        featureId: params.feature_id,
        validity: params.validity,
        clarity: params.clarity,
        completeness: params.completeness,
        stability: params.stability,
      },
      undo: {
        type: 'annotate',
        before: beforeSnapshot,
        after: afterSnapshot,
      },
    }));
  }
  const tagWarning = vocabBefore ? warnNewTagsWithVocab(vocabBefore, params.tags!) : '';
  return `Updated ${params.file}: ${updated.join(', ')}${tagWarning}`;
}

export function handleAddTodo(canopyPath: string, params: {
  file?: string; project?: string; text: string; priority: number;
  difficulty?: number; tags?: string[];
} & AgentAttributionParams): string {
  const author = resolveAgentAuthor(params);
  const manifestPath = resolveAgentManifestPathFromCanopyPath(canopyPath);
  const canopy = readCanopy(canopyPath);
  if (!!params.file === !!params.project) {
    throw new Error('Provide exactly one TODO scope: file or project.');
  }
  const fc = params.file ? canopy.files[params.file] : undefined;

  if (fc?.locked) {
    throw new Error(`File is locked: ${params.file}. Use add_comment to leave observations.`);
  }

  // Collect vocab before writing so we can detect new tags
  const vocabBefore = params.tags !== undefined ? collectTags(canopy) : null;

  let projectKey: string | undefined;
  let targetTodos: Todo[];
  if (params.project) {
    const resolved = resolveProject(canopy, params.project);
    projectKey = resolved[0];
    if (!resolved[1].todos) resolved[1].todos = [];
    targetTodos = resolved[1].todos;
  } else {
    const filePath = params.file!;
    if (!fc) canopy.files[filePath] = { todos: [] } as any;
    const file = canopy.files[filePath];
    if (!file.todos) file.todos = [];
    targetTodos = file.todos;
  }

  const id = nextTodoId(canopy);
  const todo: Todo = {
    id,
    text: params.text,
    priority: params.priority as any,
    difficulty: params.difficulty as any,
    status: 'open',
    tags: params.tags,
    createdAt: new Date().toISOString(),
    createdBy: author,
  };
  targetTodos.push(todo);
  writeCanopy(canopyPath, canopy);
  appendAgentManifestEntry(manifestPath, (manifest) => ({
    id: nextManifestEntryId(manifest),
    file: params.file,
    projectId: projectKey,
    createdAt: todo.createdAt,
    author,
    status: 'pending',
    kind: 'todo',
    headline: `Added TODO ${todo.id}`,
    fields: ['todos'],
    applied: true,
    canReject: true,
    todo: {
      text: todo.text,
      priority: todo.priority,
      difficulty: todo.difficulty,
      tags: todo.tags,
    },
    undo: {
      type: 'todo',
      todoId: todo.id,
      todo: cloneValue(todo),
    },
  }));
  const tagWarning = vocabBefore ? warnNewTagsWithVocab(vocabBefore, params.tags!) : '';
  return `Added TODO ${id} (P${params.priority}) to ${params.file ?? `project ${projectKey}`}${tagWarning}`;
}

export function handleRenameTag(canopyPath: string, params: {
  old_tag: string; new_tag: string;
} & AgentAttributionParams): string {
  const author = resolveAgentAuthor(params);
  const manifestPath = resolveAgentManifestPathFromCanopyPath(canopyPath);
  const canopy = readCanopy(canopyPath);
  let filesUpdated = 0;
  const fileChanges: Array<{ path: string; before?: string[]; after?: string[] }> = [];

  for (const [filePath, fc] of Object.entries(canopy.files)) {
    if (!fc.tags) continue;
    const idx = fc.tags.indexOf(params.old_tag);
    if (idx === -1) continue;

    const before = [...fc.tags];
    fc.tags.splice(idx, 1);
    if (!fc.tags.includes(params.new_tag)) {
      fc.tags.push(params.new_tag);
    }
    fileChanges.push({ path: filePath, before, after: [...fc.tags] });
    filesUpdated++;
  }

  if (filesUpdated === 0) {
    return `Tag "${params.old_tag}" not found in any file.`;
  }

  writeCanopy(canopyPath, canopy);
  appendAgentManifestEntry(manifestPath, (manifest) => ({
    id: nextManifestEntryId(manifest),
    file: fileChanges[0]?.path ?? '',
    createdAt: new Date().toISOString(),
    author,
    status: 'pending',
    kind: 'rename-tag',
    headline: `Renamed tag ${params.old_tag} → ${params.new_tag}`,
    fields: ['tags'],
    applied: true,
    canReject: true,
    proposal: {
      tags: [params.new_tag],
    },
    undo: {
      type: 'rename-tag',
      oldTag: params.old_tag,
      newTag: params.new_tag,
      files: fileChanges,
    },
  }));
  return `Renamed "${params.old_tag}" \u2192 "${params.new_tag}" in ${filesUpdated} file${filesUpdated !== 1 ? 's' : ''}.`;
}

export function handleStageSuggestion(canopyPath: string, manifestPath: string, params: {
  file: string;
  title?: string;
  summary?: string;
  tags?: string[];
  authority_level?: string;
  file_status?: string;
  feature_id?: string;
  validity?: number;
  clarity?: number;
  completeness?: number;
  stability?: number;
  related_files?: Array<string | { path: string; closeness?: number; relation?: string }>;
  suggested_freshness?: AgentManifestEntry['suggestedFreshness'];
  comment?: string;
  todo_text?: string;
  todo_priority?: number;
  todo_difficulty?: number;
  todo_tags?: string[];
  follow_ups?: string[];
  rationale?: string;
} & AgentAttributionParams): string {
  const author = resolveAgentAuthor(params);
  if (params.todo_priority !== undefined && params.todo_text === undefined) {
    throw new Error('todo_priority requires todo_text.');
  }
  if (params.todo_difficulty !== undefined && params.todo_text === undefined) {
    throw new Error('todo_difficulty requires todo_text.');
  }
  if (params.todo_tags !== undefined && params.todo_text === undefined) {
    throw new Error('todo_tags requires todo_text.');
  }

  const hasProposal =
    params.title !== undefined ||
    params.summary !== undefined ||
    params.tags !== undefined ||
    params.authority_level !== undefined ||
    params.file_status !== undefined ||
    params.feature_id !== undefined ||
    params.validity !== undefined ||
    params.clarity !== undefined ||
    params.completeness !== undefined ||
    params.stability !== undefined ||
    params.related_files !== undefined ||
    params.suggested_freshness !== undefined ||
    params.comment !== undefined ||
    params.todo_text !== undefined ||
    (params.follow_ups?.length ?? 0) > 0;

  if (!hasProposal) {
    throw new Error('Provide at least one staged field, comment, TODO, freshness suggestion, or follow-up.');
  }

  const canopy = readCanopy(canopyPath);
  const manifest = readAgentManifest(manifestPath);
  const vocabBefore = (params.tags !== undefined || params.todo_tags !== undefined)
    ? collectTags(canopy)
    : null;

  const proposal: NonNullable<AgentManifestEntry['proposal']> = {};
  const staged: string[] = [];

  if (params.title !== undefined) { proposal.title = params.title; staged.push('title'); }
  if (params.summary !== undefined) { proposal.summary = params.summary; staged.push('summary'); }
  if (params.tags !== undefined) { proposal.tags = params.tags; staged.push('tags'); }
  if (params.authority_level !== undefined) { proposal.authorityLevel = params.authority_level as any; staged.push('authorityLevel'); }
  if (params.file_status !== undefined) { proposal.fileStatus = params.file_status as any; staged.push('fileStatus'); }
  if (params.feature_id !== undefined) { proposal.featureId = params.feature_id; staged.push('featureId'); }
  if (params.validity !== undefined) { proposal.validity = params.validity; staged.push('validity'); }
  if (params.clarity !== undefined) { proposal.clarity = params.clarity; staged.push('clarity'); }
  if (params.completeness !== undefined) { proposal.completeness = params.completeness; staged.push('completeness'); }
  if (params.stability !== undefined) { proposal.stability = params.stability; staged.push('stability'); }
  if (params.related_files !== undefined) { proposal.relatedFiles = params.related_files as any; staged.push('relatedFiles'); }

  const entry: AgentManifestEntry = {
    id: nextManifestEntryId(manifest),
    file: params.file,
    createdAt: new Date().toISOString(),
    author,
    status: 'pending',
    kind: 'suggestion',
    headline: 'Staged suggestion',
    applied: false,
    canReject: false,
  };

  if (Object.keys(proposal).length > 0) {
    entry.proposal = proposal;
  }
  if (params.suggested_freshness !== undefined) {
    entry.suggestedFreshness = params.suggested_freshness;
    staged.push('suggestedFreshness');
  }
  if (params.comment !== undefined) {
    entry.comment = params.comment;
    staged.push('comment');
  }
  if (params.todo_text !== undefined) {
    entry.todo = {
      text: params.todo_text,
      priority: params.todo_priority as any,
      difficulty: params.todo_difficulty as any,
      tags: params.todo_tags,
    };
    staged.push('todo');
  }
  if ((params.follow_ups?.length ?? 0) > 0) {
    entry.followUps = params.follow_ups;
    staged.push('followUps');
  }
  if (params.rationale !== undefined) {
    entry.rationale = params.rationale;
    staged.push('rationale');
  }

  manifest.entries.push(entry);
  writeAgentManifest(manifestPath, manifest);

  const stagedTags = [...(params.tags ?? []), ...(params.todo_tags ?? [])];
  const tagWarning = vocabBefore ? warnNewTagsWithVocab(vocabBefore, stagedTags) : '';
  return `Staged suggestion ${entry.id} for ${params.file}: ${staged.join(', ')} in agent_manifest.json${tagWarning}`;
}
