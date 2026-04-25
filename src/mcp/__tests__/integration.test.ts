import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readCanopy } from '../../backend/lib/canopy.js';
import { buildStats } from '../../cli/stats.js';
import { buildLs } from '../../cli/ls.js';
import { buildTodos } from '../../cli/todos.js';
import { buildContext } from '../../cli/context.js';
import { handleAddComment, handleAnnotate, handleAddTodo, handleRenameTag } from '../tools/writes.js';
import { buildTags } from '../tools/tags.js';
import { walkGraph, renderGraphTree, buildReverseIndex } from '../../cli/graph.js';

let tmpDir: string;
let canopyPath: string;

function seedCanopy() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-integ-'));
  const canopyDir = path.join(tmpDir, 'canopytag');
  fs.mkdirSync(canopyDir, { recursive: true });
  canopyPath = path.join(canopyDir, 'canopy.json');

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
        feature_id: 'auth',
        validity: 4,
        clarity: 3,
        completeness: 2,
        stability: 4,
        todos: [],
        comments: [],
      },
      'src/api.ts': {
        summary: 'API routes',
        tags: ['api', 'backend'],
        authority_level: 'guideline',
        status: 'active',
        feature_id: 'auth',
        related_files: [{ path: 'src/auth.ts', closeness: 5, relation: 'implements' }],
        todos: [],
        comments: [],
      },
    },
    features: {
      auth: { name: 'Authentication', description: 'Auth system' },
    },
  };
  fs.writeFileSync(canopyPath, JSON.stringify(seed, null, 2));
}

beforeEach(seedCanopy);
afterEach(() => { try { fs.rmSync(tmpDir, { recursive: true }); } catch {} });

describe('MCP integration', () => {
  it('add_comment finding makes file appear in surprising filter', () => {
    // Add a finding comment
    handleAddComment(canopyPath, {
      file: 'src/auth.ts',
      text: 'Auth bypasses rate limiting',
      type: 'finding',
      confidence: 4,
    });

    // Read canopy and query with surprising filter
    const canopy = readCanopy(canopyPath);
    const context = buildContext(canopy, { file: 'src/auth.ts' });
    expect(context).toContain('Auth bypasses rate limiting');
    expect(context).toContain('!!');  // finding prefix
  });

  it('add_todo then buildTodos shows the new TODO', () => {
    handleAddTodo(canopyPath, {
      file: 'src/auth.ts',
      text: 'Add rate limiting',
      priority: 1,
    });

    const canopy = readCanopy(canopyPath);
    const todos = buildTodos(canopy, {});
    expect(todos).toContain('Add rate limiting');
    expect(todos).toContain('P1');
  });

  it('annotate updates summary visible in context', () => {
    handleAnnotate(canopyPath, {
      file: 'src/auth.ts',
      summary: 'Updated auth with OAuth2',
    });

    const canopy = readCanopy(canopyPath);
    const context = buildContext(canopy, { file: 'src/auth.ts' });
    expect(context).toContain('Updated auth with OAuth2');
  });

  it('rename_tag reflected in buildTags', () => {
    handleRenameTag(canopyPath, { old_tag: 'auth', new_tag: 'authentication' });

    const canopy = readCanopy(canopyPath);
    const tags = buildTags(canopy);
    expect(tags).toContain('authentication');
    // 'auth' as a standalone tag should be gone; use word-boundary check via regex
    expect(/^\s+\d+\s+auth\s*$/m.test(tags)).toBe(false);
  });

  it('feature query returns all feature files', () => {
    const canopy = readCanopy(canopyPath);
    const context = buildContext(canopy, { feature: 'auth' });
    expect(context).toContain('src/auth.ts');
    expect(context).toContain('src/api.ts');
    expect(context).toContain('Authentication');
  });

  it('stats shows correct file count', () => {
    const canopy = readCanopy(canopyPath);
    const stats = buildStats(canopy, {});
    expect(stats).toContain('2 files');
  });

  it('ls shows files with headers', () => {
    const canopy = readCanopy(canopyPath);
    const ls = buildLs(canopy, {}, 'authority', 10);
    expect(ls).toContain('FILE');
    expect(ls).toContain('src/auth.ts');
  });

  it('fan-out from api.ts shows auth.ts dependency', () => {
    const canopy = readCanopy(canopyPath);
    const tree = walkGraph(canopy, 'src/api.ts', 'out', 1);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/auth.ts');
    expect(tree.children[0].relation).toBe('implements');

    const output = renderGraphTree(tree, 'out');
    expect(output).toContain('→');
    expect(output).toContain('src/auth.ts');
  });

  it('fan-in to auth.ts shows api.ts depends on it', () => {
    const canopy = readCanopy(canopyPath);
    const tree = walkGraph(canopy, 'src/auth.ts', 'in', 1);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/api.ts');

    const output = renderGraphTree(tree, 'in');
    expect(output).toContain('←');
    expect(output).toContain('src/api.ts');
  });

  it('fan-in to file not in canopy returns empty tree', () => {
    const canopy = readCanopy(canopyPath);
    const tree = walkGraph(canopy, 'src/nonexistent.ts', 'in', 1);
    expect(tree.children).toHaveLength(0);
  });

  it('pre-built reverseIndex works', () => {
    const canopy = readCanopy(canopyPath);
    const revIdx = buildReverseIndex(canopy);
    const tree = walkGraph(canopy, 'src/auth.ts', 'in', 1, { reverseIndex: revIdx });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe('src/api.ts');
  });
});
