import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readCanopy } from '../../backend/lib/canopy.js';
import { readAgentManifest } from '../../backend/lib/agent-manifest.js';
import {
  handleAddComment,
  handleAnnotate,
  handleAddTodo,
  handleRenameTag,
  resolveAgentAuthor,
  handleStageSuggestion,
} from '../tools/writes.js';

let tmpDir: string;
let canopyPath: string;
let manifestPath: string;

function seedCanopy() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-write-'));
  const canopyDir = path.join(tmpDir, 'canopytag');
  fs.mkdirSync(canopyDir, { recursive: true });
  canopyPath = path.join(canopyDir, 'canopy.json');
  manifestPath = path.join(canopyDir, 'agent_manifest.json');

  const seed = {
    version: 1,
    repo_root: tmpDir,
    last_modified_at: '2026-04-01T00:00:00Z',
    files: {
      'src/auth.ts': {
        summary: 'Auth module',
        tags: ['auth', 'backend'],
        authority_level: 'specification',
        status: 'active',
        locked: false,
        todos: [],
        comments: [],
      },
      'src/locked.ts': {
        summary: 'Locked file',
        tags: ['core'],
        locked: true,
        todos: [],
        comments: [],
      },
    },
    features: {},
  };
  fs.writeFileSync(canopyPath, JSON.stringify(seed, null, 2));
}

beforeEach(seedCanopy);
afterEach(() => { try { fs.rmSync(tmpDir, { recursive: true }); } catch {} });

describe('handleAddComment', () => {
  it('adds a comment with dynamic agent attribution and returns the ID', () => {
    const result = handleAddComment(canopyPath, {
      file: 'src/auth.ts',
      text: 'This bypasses middleware',
      type: 'finding',
      confidence: 4,
      agent_name: 'codex',
      agent_session: 'run-42',
    });
    expect(result).toContain('RC-001');

    const canopy = readCanopy(canopyPath);
    const comments = canopy.files['src/auth.ts'].comments!;
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('finding');
    expect(comments[0].confidence).toBe(4);
    expect(comments[0].author).toEqual({ role: 'agent', name: 'codex', session: 'run-42' });

    const manifest = readAgentManifest(manifestPath);
    expect(manifest.entries[0]).toMatchObject({
      kind: 'comment',
      status: 'pending',
      applied: true,
      canReject: true,
      comment: 'This bypasses middleware',
      author: { role: 'agent', name: 'codex', session: 'run-42' },
    });
  });

  it('allows comments on locked files', () => {
    const result = handleAddComment(canopyPath, {
      file: 'src/locked.ts',
      text: 'Observation',
      type: 'note',
    });
    expect(result).toContain('RC-001');
  });

  it('creates file entry if not exists', () => {
    const result = handleAddComment(canopyPath, {
      file: 'src/new.ts',
      text: 'Found this',
      type: 'finding',
    });
    expect(result).toContain('RC-001');
    const canopy = readCanopy(canopyPath);
    expect(canopy.files['src/new.ts']).toBeDefined();
    expect(canopy.files['src/new.ts'].comments).toHaveLength(1);
  });
});

describe('handleAnnotate', () => {
  it('updates metadata fields', () => {
    const result = handleAnnotate(canopyPath, {
      file: 'src/auth.ts',
      summary: 'Updated auth module',
      tags: ['auth', 'security'],
    });
    expect(result).toContain('Updated');

    const canopy = readCanopy(canopyPath);
    expect(canopy.files['src/auth.ts'].summary).toBe('Updated auth module');
    expect(canopy.files['src/auth.ts'].tags).toEqual(['auth', 'security']);

    const manifest = readAgentManifest(manifestPath);
    expect(manifest.entries[0]).toMatchObject({
      kind: 'annotate',
      applied: true,
      status: 'pending',
      fields: ['summary', 'tags'],
      proposal: {
        summary: 'Updated auth module',
        tags: ['auth', 'security'],
      },
    });
  });

  it('throws on locked files', () => {
    expect(() => handleAnnotate(canopyPath, {
      file: 'src/locked.ts',
      summary: 'Should fail',
    })).toThrow('locked');
  });

  it('sets scoresReviewed=false when scores change', () => {
    handleAnnotate(canopyPath, {
      file: 'src/auth.ts',
      validity: 4,
    });
    const canopy = readCanopy(canopyPath);
    expect(canopy.files['src/auth.ts'].scoresReviewed).toBe(false);
  });
});

describe('handleAddTodo', () => {
  it('adds a TODO and returns the ID', () => {
    const result = handleAddTodo(canopyPath, {
      file: 'src/auth.ts',
      text: 'Add rate limiting',
      priority: 2,
      difficulty: 3,
    });
    expect(result).toContain('RT-001');

    const manifest = readAgentManifest(manifestPath);
    expect(manifest.entries[0]).toMatchObject({
      kind: 'todo',
      applied: true,
      status: 'pending',
      todo: {
        text: 'Add rate limiting',
        priority: 2,
        difficulty: 3,
      },
    });
  });

  it('throws on locked files', () => {
    expect(() => handleAddTodo(canopyPath, {
      file: 'src/locked.ts',
      text: 'Should fail',
      priority: 3,
    })).toThrow('locked');
  });
});

describe('handleRenameTag', () => {
  it('renames a tag across all files', () => {
    handleRenameTag(canopyPath, { old_tag: 'auth', new_tag: 'authentication' });
    const canopy = readCanopy(canopyPath);
    expect(canopy.files['src/auth.ts'].tags).toContain('authentication');
    expect(canopy.files['src/auth.ts'].tags).not.toContain('auth');
  });

  it('deduplicates when target tag already exists', () => {
    handleRenameTag(canopyPath, { old_tag: 'auth', new_tag: 'backend' });
    const canopy = readCanopy(canopyPath);
    const tags = canopy.files['src/auth.ts'].tags!;
    expect(tags.filter(t => t === 'backend')).toHaveLength(1);
  });

  it('errors when old tag not found', () => {
    const result = handleRenameTag(canopyPath, { old_tag: 'nonexistent', new_tag: 'foo' });
    expect(result).toContain('not found');
  });
});

describe('resolveAgentAuthor', () => {
  it('falls back to environment attribution before generic agent', () => {
    const previousName = process.env.CANOPYTAG_AGENT_NAME;
    const previousSession = process.env.CANOPYTAG_AGENT_SESSION;
    try {
      process.env.CANOPYTAG_AGENT_NAME = 'canopy-agent';
      process.env.CANOPYTAG_AGENT_SESSION = 'session-99';
      expect(resolveAgentAuthor()).toEqual({
        role: 'agent',
        name: 'canopy-agent',
        session: 'session-99',
      });
    } finally {
      if (previousName === undefined) {
        delete process.env.CANOPYTAG_AGENT_NAME;
      } else {
        process.env.CANOPYTAG_AGENT_NAME = previousName;
      }
      if (previousSession === undefined) {
        delete process.env.CANOPYTAG_AGENT_SESSION;
      } else {
        process.env.CANOPYTAG_AGENT_SESSION = previousSession;
      }
    }
  });
});

describe('handleStageSuggestion', () => {
  it('writes non-canonical suggestions to agent_manifest.json', () => {
    const result = handleStageSuggestion(canopyPath, manifestPath, {
      file: 'src/auth.ts',
      summary: 'Likely needs stronger token lifecycle notes',
      tags: ['auth', 'security'],
      related_files: [{ path: 'src/api.ts', closeness: 4, relation: 'implements' }],
      suggested_freshness: 'stale',
      comment: 'Manual review suggested after session rewrite.',
      todo_text: 'Review refresh token invariants',
      todo_priority: 2,
      follow_ups: ['src/api.ts', 'tests/auth.test.ts'],
      rationale: 'Holding this in the sidecar until a human confirms the rewrite settled.',
    });

    expect(result).toContain('AM-001');
    expect(result).toContain('agent_manifest.json');

    const manifest = readAgentManifest(manifestPath);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({
      id: 'AM-001',
      file: 'src/auth.ts',
      status: 'pending',
      suggestedFreshness: 'stale',
      comment: 'Manual review suggested after session rewrite.',
      followUps: ['src/api.ts', 'tests/auth.test.ts'],
      proposal: {
        summary: 'Likely needs stronger token lifecycle notes',
        tags: ['auth', 'security'],
      },
      todo: {
        text: 'Review refresh token invariants',
        priority: 2,
      },
    });
  });

  it('rejects orphaned todo metadata without todo text', () => {
    expect(() => handleStageSuggestion(canopyPath, manifestPath, {
      file: 'src/auth.ts',
      todo_priority: 2,
    })).toThrow('todo_priority requires todo_text');
  });
});
