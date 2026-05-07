import fs from 'fs';
import path from 'path';
import { snakeToCamel, camelToSnake } from '../../shared/case-transform';
import type { Canopy, CanopySettings, CanopyArchive, ArchiveRetention } from '../../shared/types';

function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * Resolve the canopy directory for a repo.
 * CanopyTag uses the visible `canopytag/` directory for agent discoverability.
 */
export function resolveCanopyDir(repoRoot: string): string {
  return path.join(repoRoot, 'canopytag');
}

const EMPTY_CANOPY: Canopy = {
  version: 1,
  repoRoot: '',
  lastModifiedAt: '',
  files: {},
  features: {},
};

export function parseJsonFile(filePath: string): unknown {
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function validateCanopyShape(obj: unknown): Canopy {
  if (!isPlainObject(obj)) {
    throw new Error('Invalid canopy.json: expected a JSON object');
  }
  if (typeof obj.version !== 'number') {
    throw new Error(
      `Invalid canopy.json: 'version' must be a number (got ${obj.version === undefined ? 'undefined' : typeof obj.version})`
    );
  }
  if (!isPlainObject(obj.files)) {
    const got = Array.isArray(obj.files) ? 'array' : obj.files === null ? 'null' : typeof obj.files;
    throw new Error(`Invalid canopy.json: 'files' must be an object (got ${got})`);
  }
  if (obj.features !== undefined && !isPlainObject(obj.features)) {
    const got = Array.isArray(obj.features) ? 'array' : obj.features === null ? 'null' : typeof obj.features;
    throw new Error(`Invalid canopy.json: 'features' must be an object (got ${got})`);
  }
  return { ...obj, features: obj.features ?? {} } as Canopy;
}

export function readCanopy(filePath: string): Canopy {
  if (!fs.existsSync(filePath)) {
    return { ...EMPTY_CANOPY };
  }
  const raw = parseJsonFile(filePath);
  return validateCanopyShape(snakeToCamel(raw));
}

export function writeCanopy(filePath: string, canopy: Canopy): void {
  const updated = { ...canopy, lastModifiedAt: new Date().toISOString() };
  const snake = camelToSnake(updated);
  atomicWrite(filePath, JSON.stringify(snake, null, 2) + '\n');
}

export function nextTodoId(canopy: Canopy): string {
  let max = 0;
  for (const file of Object.values(canopy.files)) {
    for (const todo of file.todos ?? []) {
      const match = todo.id.match(/^RT-(\d+)$/);
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
  }
  return `RT-${String(max + 1).padStart(3, '0')}`;
}

export function nextCommentId(canopy: Canopy): string {
  let max = 0;
  for (const file of Object.values(canopy.files)) {
    for (const c of file.comments ?? []) {
      const match = c.id?.match(/^RC-(\d+)$/);
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
  }
  return `RC-${String(max + 1).padStart(3, '0')}`;
}

export function ensureCommentIds(canopy: Canopy): void {
  for (const file of Object.values(canopy.files)) {
    for (const c of file.comments ?? []) {
      if (!c.id) {
        c.id = nextCommentId(canopy);
      }
    }
  }
}

// ---- Settings ----

const DEFAULT_SETTINGS: CanopySettings = { archiveRetention: '7d' };
const VALID_RETENTIONS = new Set<string>(['off', '1d', '7d', '30d']);

export function readSettings(settingsPath: string): CanopySettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = parseJsonFile(settingsPath);
      const parsed = snakeToCamel(raw) as Record<string, unknown>;
      return {
        archiveRetention: VALID_RETENTIONS.has(parsed.archiveRetention as string)
          ? (parsed.archiveRetention as ArchiveRetention)
          : DEFAULT_SETTINGS.archiveRetention,
        analyticsEnabled: typeof parsed.analyticsEnabled === 'boolean'
          ? parsed.analyticsEnabled
          : undefined,
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function writeSettings(settingsPath: string, settings: CanopySettings): void {
  const validated: CanopySettings = {
    archiveRetention: VALID_RETENTIONS.has(settings.archiveRetention)
      ? settings.archiveRetention
      : DEFAULT_SETTINGS.archiveRetention,
  };
  if (typeof settings.analyticsEnabled === 'boolean') {
    validated.analyticsEnabled = settings.analyticsEnabled;
  }
  atomicWrite(settingsPath, JSON.stringify(camelToSnake(validated), null, 2) + '\n');
}

// ---- Archive ----

export function readArchive(archivePath: string): CanopyArchive {
  try {
    if (fs.existsSync(archivePath)) {
      return snakeToCamel(parseJsonFile(archivePath)) as CanopyArchive;
    }
  } catch { /* ignore */ }
  return { version: 1, items: [] };
}

export function writeArchive(archivePath: string, archive: CanopyArchive): void {
  atomicWrite(archivePath, JSON.stringify(camelToSnake(archive), null, 2) + '\n');
}

export function runArchiveSweep(
  canopy: Canopy,
  archive: CanopyArchive,
  retention: ArchiveRetention,
): { canopy: Canopy; archive: CanopyArchive; swept: number } {
  if (retention === 'off') return { canopy, archive, swept: 0 };

  const retentionMs: Record<string, number> = { '1d': 86400000, '7d': 604800000, '30d': 2592000000 };
  const cutoff = Date.now() - retentionMs[retention];
  let swept = 0;

  for (const [filePath, file] of Object.entries(canopy.files)) {
    if (!file.todos?.length) continue;
    const keep: typeof file.todos = [];
    for (const todo of file.todos) {
      if (todo.status === 'done') {
        const doneTime = new Date(todo.completedAt ?? todo.createdAt).getTime();
        if (doneTime < cutoff) {
          archive.items.push({
            archivedAt: new Date().toISOString(),
            filePath,
            kind: 'todo',
            item: todo,
          });
          swept++;
          continue;
        }
      }
      keep.push(todo);
    }
    file.todos = keep;
  }

  return { canopy, archive, swept };
}
