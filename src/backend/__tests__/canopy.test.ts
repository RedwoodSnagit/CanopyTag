import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { readCanopy, readSettings, readArchive, writeCanopy, nextTodoId } from '../lib/canopy';

const TEST_DIR = path.join(import.meta.dirname, '__test_workspace__');
const TEST_CANOPY = path.join(TEST_DIR, 'canopy.json');
const TEST_SETTINGS = path.join(TEST_DIR, 'settings.json');
const TEST_ARCHIVE = path.join(TEST_DIR, 'canopy_archive.json');

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readCanopy', () => {
  it('returns empty canopy when file does not exist', () => {
    const canopy = readCanopy(path.join(TEST_DIR, 'nope.json'));
    expect(canopy.version).toBe(1);
    expect(canopy.files).toEqual({});
    expect(canopy.features).toEqual({});
  });

  it('reads existing canopy and converts to camelCase', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({
      version: 1,
      repo_root: '/test',
      last_modified_at: '2026-01-01T00:00:00Z',
      files: {
        'test.py': {
          summary: 'A test file',
          authority_level: 'guideline',
        }
      },
      features: {}
    }));
    const canopy = readCanopy(TEST_CANOPY);
    expect(canopy.files['test.py']).toBeDefined();
    expect(canopy.repoRoot).toBe('/test');
  });

  it('reads canopy files with a UTF-8 BOM', () => {
    fs.writeFileSync(TEST_CANOPY, '\uFEFF' + JSON.stringify({
      version: 1,
      repo_root: '',
      last_modified_at: '',
      files: {},
      features: {},
    }));

    expect(() => readCanopy(TEST_CANOPY)).not.toThrow();
    expect(readCanopy(TEST_CANOPY).version).toBe(1);
  });
});

describe('readCanopy validation', () => {
  it('accepts a well-formed canopy file', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({
      version: 1, repo_root: '/test', last_modified_at: '', files: {}, features: {}
    }));
    expect(() => readCanopy(TEST_CANOPY)).not.toThrow();
  });

  it('throws when version is missing', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({ files: {}, features: {} }));
    expect(() => readCanopy(TEST_CANOPY)).toThrow(/version/);
  });

  it('throws when version is a string', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({ version: '1', files: {}, features: {} }));
    expect(() => readCanopy(TEST_CANOPY)).toThrow(/version/);
  });

  it('throws when files is null', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({ version: 1, files: null, features: {} }));
    expect(() => readCanopy(TEST_CANOPY)).toThrow(/files/);
  });

  it('throws when files is an array', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({ version: 1, files: [1, 2, 3], features: {} }));
    expect(() => readCanopy(TEST_CANOPY)).toThrow(/files/);
  });

  it('throws when features is a non-object', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({ version: 1, files: {}, features: 'bad' }));
    expect(() => readCanopy(TEST_CANOPY)).toThrow(/features/);
  });

  it('defaults features to {} when absent', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({
      version: 1, repo_root: '/test', last_modified_at: '', files: {}
    }));
    const canopy = readCanopy(TEST_CANOPY);
    expect(canopy.features).toEqual({});
  });

  it('allows extra unknown top-level keys', () => {
    fs.writeFileSync(TEST_CANOPY, JSON.stringify({
      version: 1, files: {}, features: {}, custom_field: 'hello'
    }));
    expect(() => readCanopy(TEST_CANOPY)).not.toThrow();
  });
});

describe('metadata JSON readers', () => {
  it('reads settings files with a UTF-8 BOM', () => {
    fs.writeFileSync(TEST_SETTINGS, '\uFEFF' + JSON.stringify({
      archive_retention: '30d',
    }));

    expect(readSettings(TEST_SETTINGS).archiveRetention).toBe('30d');
  });

  it('reads archive files with a UTF-8 BOM', () => {
    fs.writeFileSync(TEST_ARCHIVE, '\uFEFF' + JSON.stringify({
      version: 1,
      items: [],
    }));

    expect(readArchive(TEST_ARCHIVE).version).toBe(1);
  });
});

describe('writeCanopy', () => {
  it('writes canopy as snake_case JSON', () => {
    writeCanopy(TEST_CANOPY, {
      version: 1,
      repoRoot: '/test',
      lastModifiedAt: '2026-01-01T00:00:00Z',
      files: {},
      features: {},
    });
    const raw = JSON.parse(fs.readFileSync(TEST_CANOPY, 'utf-8'));
    expect(raw.repo_root).toBe('/test');
    expect(raw.last_modified_at).toBeDefined();
  });
});

describe('writeCanopy atomic write', () => {
  it('does not leave .tmp files behind after a successful write', () => {
    writeCanopy(TEST_CANOPY, {
      version: 1,
      repoRoot: '/test',
      lastModifiedAt: '2026-01-01T00:00:00Z',
      files: {},
      features: {},
    });
    expect(fs.existsSync(TEST_CANOPY)).toBe(true);
    expect(fs.existsSync(TEST_CANOPY + '.tmp')).toBe(false);
  });
});

describe('nextTodoId', () => {
  it('returns RT-001 for empty canopy', () => {
    expect(nextTodoId({ version: 1, repoRoot: '', lastModifiedAt: '', files: {}, features: {} }))
      .toBe('RT-001');
  });

  it('increments past existing IDs', () => {
    const canopy = {
      version: 1, repoRoot: '', lastModifiedAt: '', features: {},
      files: {
        'a.py': { todos: [{ id: 'RT-003', text: '', priority: 1 as const, status: 'open' as const, createdAt: '', createdBy: 'human' as const }] }
      }
    };
    expect(nextTodoId(canopy)).toBe('RT-004');
  });
});
