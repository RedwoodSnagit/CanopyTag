import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_DIR = path.join(os.tmpdir(), 'canopytag-hook-install-test');
const tsxCli = path.join(import.meta.dirname, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const hookInstallScript = path.join(import.meta.dirname, '..', 'hook.ts');

function runHookInstall(repoDir: string): string {
  return execFileSync(
    process.execPath,
    [tsxCli, hookInstallScript, 'install'],
    { cwd: repoDir, encoding: 'utf-8' },
  );
}

function readSettings(repoDir: string): any {
  return JSON.parse(fs.readFileSync(path.join(repoDir, '.claude', 'settings.json'), 'utf-8'));
}

beforeEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('canopytag hook install', () => {
  it('writes an absolute hook command so target repos do not need a local hooks directory', () => {
    const output = runHookInstall(TEST_DIR);
    const settings = readSettings(TEST_DIR);
    const entry = settings.hooks.PostToolUse[0];
    const command = entry.hooks[0].command;
    const hookPath = command.match(/^node "(.+canopytag-analytics\.mjs)"$/)?.[1];

    expect(output).toContain('Analytics hook installed');
    expect(entry.matcher).toBe('Read|Edit|Write|Grep|Glob|Bash');
    expect(command).toContain('canopytag-analytics.mjs');
    expect(command).not.toBe('node hooks/canopytag-analytics.mjs');
    expect(hookPath).toBeDefined();
    expect(path.isAbsolute(hookPath!)).toBe(true);
    expect(fs.existsSync(hookPath!)).toBe(true);
  });

  it('upgrades an older relative hook command in place', () => {
    fs.mkdirSync(path.join(TEST_DIR, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PostToolUse: [{
          matcher: 'Read|Edit|Write',
          hooks: [{ type: 'command', command: 'node hooks/canopytag-analytics.mjs' }],
        }],
      },
    }, null, 2));

    const output = runHookInstall(TEST_DIR);
    const settings = readSettings(TEST_DIR);
    const entries = settings.hooks.PostToolUse;
    const command = entries[0].hooks[0].command;

    expect(output).toContain('Analytics hook updated');
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe('Read|Edit|Write|Grep|Glob|Bash');
    expect(command).toContain('canopytag-analytics.mjs');
    expect(command).not.toBe('node hooks/canopytag-analytics.mjs');
  });

  it('reads existing Claude settings with a UTF-8 BOM', () => {
    fs.mkdirSync(path.join(TEST_DIR, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, '.claude', 'settings.json'), '\uFEFF' + JSON.stringify({
      note: 'keep me',
    }, null, 2));

    const output = runHookInstall(TEST_DIR);
    const settings = readSettings(TEST_DIR);

    expect(output).toContain('Analytics hook installed');
    expect(settings.note).toBe('keep me');
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Read|Edit|Write|Grep|Glob|Bash');
  });
});
