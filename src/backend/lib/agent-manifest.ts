import fs from 'node:fs';
import path from 'node:path';
import { snakeToCamel, camelToSnake } from '../../shared/case-transform';
import { nextCommentId, parseJsonFile, readCanopy, writeCanopy } from './canopy.js';
import type {
  AgentManifest,
  AgentManifestEntry,
  AgentReviewAction,
  Author,
  Comment,
  FileCanopy,
} from '../../shared/types';
import { resolveCanopyPath } from '../../cli/shared.js';

const EMPTY_AGENT_MANIFEST: AgentManifest = {
  version: 1,
  entries: [],
};

function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function validateManifestShape(obj: unknown): AgentManifest {
  if (!isPlainObject(obj)) {
    throw new Error('Invalid agent_manifest.json: expected a JSON object');
  }
  if (obj.version !== undefined && typeof obj.version !== 'number') {
    throw new Error(
      `Invalid agent_manifest.json: 'version' must be a number (got ${typeof obj.version})`
    );
  }
  if (obj.entries !== undefined && !Array.isArray(obj.entries)) {
    const got = obj.entries === null ? 'null' : typeof obj.entries;
    throw new Error(`Invalid agent_manifest.json: 'entries' must be an array (got ${got})`);
  }
  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    entries: Array.isArray(obj.entries) ? (obj.entries as AgentManifest['entries']) : [],
  };
}

export function emptyAgentManifest(): AgentManifest {
  return {
    version: EMPTY_AGENT_MANIFEST.version,
    entries: [],
  };
}

export function resolveAgentManifestPath(repoRoot?: string): string {
  const canopyPath = resolveCanopyPath(repoRoot);
  return resolveAgentManifestPathFromCanopyPath(canopyPath);
}

export function resolveAgentManifestPathFromCanopyPath(canopyPath: string): string {
  return path.join(path.dirname(canopyPath), 'agent_manifest.json');
}

export function readAgentManifest(filePath: string): AgentManifest {
  if (!fs.existsSync(filePath)) {
    return emptyAgentManifest();
  }
  const raw = parseJsonFile(filePath);
  const manifest = validateManifestShape(snakeToCamel(raw));
  manifest.entries = manifest.entries.map(normalizeManifestEntry);
  return manifest;
}

export function writeAgentManifest(filePath: string, manifest: AgentManifest): void {
  const snake = camelToSnake(manifest);
  atomicWrite(filePath, JSON.stringify(snake, null, 2) + '\n');
}

export function nextManifestEntryId(manifest: AgentManifest): string {
  let max = 0;
  for (const entry of manifest.entries) {
    const match = entry.id.match(/^AM-(\d+)$/);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `AM-${String(max + 1).padStart(3, '0')}`;
}

function normalizeManifestEntry(entry: AgentManifestEntry): AgentManifestEntry {
  const legacyStatus = entry.status as string;
  const status = legacyStatus === 'accepted'
    ? 'agreed'
    : legacyStatus === 'dismissed'
      ? 'rejected'
      : entry.status;
  return { ...entry, status };
}

export function appendAgentManifestEntry(
  manifestPath: string,
  buildEntry: (manifest: AgentManifest) => AgentManifestEntry,
): AgentManifestEntry {
  const manifest = readAgentManifest(manifestPath);
  const entry = normalizeManifestEntry(buildEntry(manifest));
  manifest.entries.push(entry);
  writeAgentManifest(manifestPath, manifest);
  return entry;
}

function ensureFileEntry(canopy: ReturnType<typeof readCanopy>, filePath: string): FileCanopy {
  if (!canopy.files[filePath]) {
    canopy.files[filePath] = {};
  }
  return canopy.files[filePath];
}

function pruneEmptyFileCanopy(canopy: ReturnType<typeof readCanopy>, filePath: string): void {
  const entry = canopy.files[filePath];
  if (!entry) return;
  if (Object.keys(entry).length === 0) {
    delete canopy.files[filePath];
  }
}

function applyBeforeSnapshot(target: FileCanopy, snapshot: Partial<FileCanopy>, field: keyof FileCanopy): void {
  const value = snapshot[field];
  if (value === undefined) {
    delete target[field];
  } else {
    (target as any)[field] = value;
  }
}

function revertManifestEntry(canopyPath: string, entry: AgentManifestEntry): void {
  const undo = entry.undo;
  if (!undo || !entry.canReject) return;

  const canopy = readCanopy(canopyPath);
  const file = ensureFileEntry(canopy, entry.file);

  switch (undo.type) {
    case 'annotate': {
      const fields = new Set<keyof FileCanopy>([
        ...(Object.keys(undo.before) as Array<keyof FileCanopy>),
        ...(Object.keys(undo.after) as Array<keyof FileCanopy>),
      ]);
      for (const field of fields) {
        applyBeforeSnapshot(file, undo.before, field);
      }
      pruneEmptyFileCanopy(canopy, entry.file);
      break;
    }
    case 'comment': {
      const comments = file.comments ?? [];
      file.comments = comments.filter((comment) => comment.id !== undo.commentId);
      if (file.comments.length === 0) delete file.comments;
      pruneEmptyFileCanopy(canopy, entry.file);
      break;
    }
    case 'todo': {
      const todos = file.todos ?? [];
      file.todos = todos.filter((todo) => todo.id !== undo.todoId);
      if (file.todos.length === 0) delete file.todos;
      pruneEmptyFileCanopy(canopy, entry.file);
      break;
    }
    case 'rename-tag': {
      for (const fileChange of undo.files) {
        const target = ensureFileEntry(canopy, fileChange.path);
        if (fileChange.before === undefined) {
          delete target.tags;
        } else {
          target.tags = [...fileChange.before];
        }
        pruneEmptyFileCanopy(canopy, fileChange.path);
      }
      break;
    }
    case 'suggestion':
      break;
  }

  writeCanopy(canopyPath, canopy);
}

function addHumanFixComment(canopyPath: string, filePath: string, note: string, reviewer: Author): Comment {
  const canopy = readCanopy(canopyPath);
  const file = ensureFileEntry(canopy, filePath);
  if (!file.comments) file.comments = [];

  const comment: Comment = {
    id: nextCommentId(canopy),
    text: note.trim(),
    author: reviewer,
    createdAt: new Date().toISOString(),
    type: 'improvement',
  };

  file.comments.push(comment);
  writeCanopy(canopyPath, canopy);
  return comment;
}

export function reviewAgentManifestEntry(
  canopyPath: string,
  manifestPath: string,
  params: { id: string; action: AgentReviewAction; note?: string; reviewer?: Author },
): AgentManifestEntry {
  const manifest = readAgentManifest(manifestPath);
  const entry = manifest.entries.find((candidate) => candidate.id === params.id);

  if (!entry) {
    throw new Error(`Activity entry not found: ${params.id}`);
  }

  if (entry.status !== 'pending') {
    throw new Error(`Activity entry ${params.id} is already ${entry.status}.`);
  }

  const reviewer = params.reviewer ?? { role: 'human' as const };
  const now = new Date().toISOString();

  if (params.action === 'fix') {
    const note = params.note?.trim();
    if (!note) {
      throw new Error('Fix requires a note.');
    }
    addHumanFixComment(canopyPath, entry.file, note, reviewer);
    entry.status = 'fixed';
    entry.reviewNote = note;
  } else if (params.action === 'reject') {
    revertManifestEntry(canopyPath, entry);
    entry.status = 'rejected';
    entry.reviewNote = params.note?.trim() || undefined;
  } else {
    entry.status = 'agreed';
    entry.reviewNote = params.note?.trim() || undefined;
  }

  entry.reviewedAt = now;
  entry.reviewer = reviewer;
  writeAgentManifest(manifestPath, manifest);
  return entry;
}
