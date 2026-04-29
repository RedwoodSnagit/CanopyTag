import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DIR = path.join(import.meta.dirname, '__test_init_workspace__');
const tsxCli = path.join(import.meta.dirname, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const initScript = path.join(import.meta.dirname, '..', 'init.ts');

function runInit(repoDir: string): string {
  return execFileSync(
    process.execPath,
    [tsxCli, initScript, '--repo', repoDir],
    { encoding: 'utf-8' },
  );
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('canopytag init', () => {
  it('creates canopytag/ directory with canopy.json, agent_manifest.json, settings.json, and local profile', () => {
    const output = runInit(TEST_DIR);
    const canopyDir = path.join(TEST_DIR, 'canopytag');

    expect(fs.existsSync(path.join(canopyDir, 'canopy.json'))).toBe(true);
    expect(fs.existsSync(path.join(canopyDir, 'agent_manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(canopyDir, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(canopyDir, 'profile.local.json'))).toBe(true);

    const canopy = JSON.parse(fs.readFileSync(path.join(canopyDir, 'canopy.json'), 'utf-8'));
    expect(canopy.version).toBe(1);
    expect(canopy.repo_root).toBe('');
    expect(canopy.files).toEqual({});

    const manifest = JSON.parse(fs.readFileSync(path.join(canopyDir, 'agent_manifest.json'), 'utf-8'));
    expect(manifest.version).toBe(1);
    expect(manifest.entries).toEqual([]);

    const settings = JSON.parse(fs.readFileSync(path.join(canopyDir, 'settings.json'), 'utf-8'));
    expect(settings.archive_retention).toBe('7d');

    const profile = JSON.parse(fs.readFileSync(path.join(canopyDir, 'profile.local.json'), 'utf-8'));
    expect(profile.current_author.role).toBe('human');

    const ignore = fs.readFileSync(path.join(TEST_DIR, '.gitignore'), 'utf-8');
    expect(ignore).toContain('canopytag/profile.local.json');

    expect(output).toContain('Initialized');
  });

  it('detects existing canopytag/ and reports status without overwriting', () => {
    const canopyDir = path.join(TEST_DIR, 'canopytag');
    fs.mkdirSync(canopyDir, { recursive: true });
    fs.writeFileSync(path.join(canopyDir, 'canopy.json'), JSON.stringify({
      version: 1, files: { 'a.ts': { summary: 'existing' } }, features: {}
    }));

    const output = runInit(TEST_DIR);
    expect(output).toContain('Already initialized');
    expect(output).toContain('agent_manifest.json');
    expect(output).toContain('profile.local.json');
    expect(fs.existsSync(path.join(canopyDir, 'profile.local.json'))).toBe(true);

    const canopy = JSON.parse(fs.readFileSync(path.join(canopyDir, 'canopy.json'), 'utf-8'));
    expect(canopy.files['a.ts']).toBeDefined();
  });

  it('detects existing .canopytag/ (hidden) and reports it', () => {
    const hiddenDir = path.join(TEST_DIR, '.canopytag');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(path.join(hiddenDir, 'canopy.json'), JSON.stringify({
      version: 1, files: {}, features: {}
    }));

    const output = runInit(TEST_DIR);
    expect(output).toContain('Already initialized');
    expect(output).toContain('.canopytag');

    expect(fs.existsSync(path.join(TEST_DIR, 'canopytag', 'canopy.json'))).toBe(false);
  });
});
