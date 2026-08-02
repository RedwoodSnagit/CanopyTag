import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tsxCli = path.join(import.meta.dirname, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const workScript = path.join(import.meta.dirname, '..', 'work.ts');
let repoRoot: string;

function runWork(args: string[]) {
  return spawnSync(process.execPath, [tsxCli, workScript, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, CANOPYTAG_AGENT_NAME: '', CANOPYTAG_AGENT_SESSION: '' },
  });
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canopytag-work-cli-'));
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'canopytag'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repoRoot, 'canopytag', 'canopy.json'), JSON.stringify({
    version: 1,
    repo_root: '',
    files: {
      'src/a.ts': {
        summary: 'A',
        todos: [{ id: 'T-1', text: 'Improve A', status: 'open', priority: 2 }],
      },
    },
    features: {},
  }));
});

afterEach(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

describe('canopytag work CLI', () => {
  it('claims, queries, rejects an overlap, and releases local work', () => {
    const claimed = runWork([
      'claim', '--repo', repoRoot, '--path', 'src/a.ts', '--summary', 'Improve A',
      '--owner', 'agent-a', '--session', 'thread-1', '--todo-id', 'T-1',
      '--todo-file', 'src/a.ts', '--json',
    ]);
    expect(claimed.status).toBe(0);
    const claim = JSON.parse(claimed.stdout);
    expect(claim.todo).toEqual({ file: 'src/a.ts', id: 'T-1' });
    expect(claim.paths[0]).toEqual({ path: 'src/a.ts', kind: 'file' });

    const humanList = runWork(['list', '--repo', repoRoot]);
    expect(humanList.stdout).toContain(claim.id);

    const ignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf-8');
    expect(ignore).toContain('canopytag/.active_work.json*');

    const listed = runWork(['list', '--repo', repoRoot, '--path', 'src', '--json']);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout)).toHaveLength(1);

    const conflict = runWork([
      'claim', '--repo', repoRoot, '--path', 'src/a.ts', '--summary', 'Competing edit',
      '--owner', 'agent-b', '--json',
    ]);
    expect(conflict.status).toBe(2);
    expect(JSON.parse(conflict.stdout).conflicts).toHaveLength(1);

    const released = runWork([
      'release', claim.id, '--repo', repoRoot, '--owner', 'agent-a',
      '--session', 'thread-1', '--note', 'Done', '--json',
    ]);
    expect(released.status).toBe(0);
    expect(JSON.parse(released.stdout).state).toBe('released');

    const active = runWork(['list', '--repo', repoRoot, '--json']);
    expect(JSON.parse(active.stdout)).toHaveLength(0);
    const history = runWork(['list', '--repo', repoRoot, '--all', '--json']);
    expect(JSON.parse(history.stdout)[0].release_note).toBe('Done');
  }, 15_000);
});
