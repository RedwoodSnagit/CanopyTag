import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectHumanAuthor,
  ensureLocalFileIgnored,
  ensureProfileIgnored,
  readOrCreateProfile,
  readProfile,
  writeProfile,
} from '../lib/profile';

const TEST_DIR = path.join(import.meta.dirname, '__test_profile_workspace__');
const LINKED_TEST_DIR = path.join(import.meta.dirname, '__test_profile_linked_workspace__');

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.CANOPYTAG_AUTHOR_NAME;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(LINKED_TEST_DIR, { recursive: true, force: true });
});

describe('profile local identity', () => {
  it('detects a human author from environment fallback', () => {
    process.env.CANOPYTAG_AUTHOR_NAME = 'Local Reviewer';

    expect(detectHumanAuthor(TEST_DIR)).toEqual({
      role: 'human',
      name: 'Local Reviewer',
    });
  });

  it('creates a local profile file using snake_case on disk', () => {
    process.env.CANOPYTAG_AUTHOR_NAME = 'Local Reviewer';
    const profilePath = path.join(TEST_DIR, 'canopytag', 'profile.local.json');

    const profile = readOrCreateProfile(profilePath, TEST_DIR);
    const raw = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

    expect(profile.currentAuthor).toEqual({ role: 'human', name: 'Local Reviewer' });
    expect(raw.current_author).toEqual({ role: 'human', name: 'Local Reviewer' });
  });

  it('sanitizes saved profiles back to human authors', () => {
    const profilePath = path.join(TEST_DIR, 'canopytag', 'profile.local.json');

    writeProfile(profilePath, {
      version: 1,
      currentAuthor: { role: 'agent', name: 'bot-name' },
    });

    expect(readProfile(profilePath, TEST_DIR).currentAuthor).toEqual({
      role: 'human',
      name: 'bot-name',
    });
  });

  it('reads local profiles with a UTF-8 BOM', () => {
    const profilePath = path.join(TEST_DIR, 'canopytag', 'profile.local.json');
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, '\uFEFF' + JSON.stringify({
      version: 1,
      current_author: { role: 'human', name: 'Local Reviewer' },
    }));

    expect(readProfile(profilePath, TEST_DIR).currentAuthor).toEqual({
      role: 'human',
      name: 'Local Reviewer',
    });
  });

  it('adds the local profile to git info exclude when available', () => {
    execFileSync('git', ['init'], { cwd: TEST_DIR, stdio: 'ignore' });
    const profilePath = path.join(TEST_DIR, 'canopytag', 'profile.local.json');

    ensureProfileIgnored(TEST_DIR, profilePath);
    ensureProfileIgnored(TEST_DIR, profilePath);

    const gitInfo = path.join(TEST_DIR, '.git', 'info');
    const exclude = fs.readFileSync(path.join(gitInfo, 'exclude'), 'utf-8');
    expect(exclude.match(/canopytag\/profile\.local\.json/g)).toHaveLength(1);
  });

  it('uses Git info exclude from a linked worktree without editing tracked .gitignore', () => {
    execFileSync('git', ['init'], { cwd: TEST_DIR, stdio: 'ignore' });
    fs.writeFileSync(path.join(TEST_DIR, 'seed.txt'), 'seed\n');
    execFileSync('git', ['add', 'seed.txt'], { cwd: TEST_DIR, stdio: 'ignore' });
    execFileSync('git', [
      '-c', 'user.name=CanopyTag Test', '-c', 'user.email=test@example.invalid',
      'commit', '-m', 'seed',
    ], { cwd: TEST_DIR, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'linked-test', LINKED_TEST_DIR], {
      cwd: TEST_DIR,
      stdio: 'ignore',
    });

    const localPath = path.join(LINKED_TEST_DIR, 'canopytag', '.active_work.json');
    ensureLocalFileIgnored(LINKED_TEST_DIR, localPath, '# CanopyTag local active work', '*');

    expect(fs.existsSync(path.join(LINKED_TEST_DIR, '.gitignore'))).toBe(false);
    expect(execFileSync('git', ['check-ignore', 'canopytag/.active_work.json'], {
      cwd: LINKED_TEST_DIR,
      encoding: 'utf-8',
    }).trim()).toBe('canopytag/.active_work.json');
    expect(execFileSync('git', ['check-ignore', 'canopytag/.active_work.json.lock'], {
      cwd: LINKED_TEST_DIR,
      encoding: 'utf-8',
    }).trim()).toBe('canopytag/.active_work.json.lock');
    expect(execFileSync('git', ['check-ignore', 'canopytag/.active_work.json.1234.abcd.tmp'], {
      cwd: LINKED_TEST_DIR,
      encoding: 'utf-8',
    }).trim()).toBe('canopytag/.active_work.json.1234.abcd.tmp');
  });

  it('upgrades an exact active-work ignore so lock and temporary siblings stay local', () => {
    execFileSync('git', ['init'], { cwd: TEST_DIR, stdio: 'ignore' });
    fs.writeFileSync(path.join(TEST_DIR, '.gitignore'), 'canopytag/.active_work.json\n');
    const localPath = path.join(TEST_DIR, 'canopytag', '.active_work.json');

    ensureLocalFileIgnored(TEST_DIR, localPath, '# CanopyTag local active work', '*');

    const gitInfo = path.join(TEST_DIR, '.git', 'info');
    const exclude = fs.readFileSync(path.join(gitInfo, 'exclude'), 'utf-8');
    expect(exclude).toContain('canopytag/.active_work.json*');
    expect(execFileSync('git', ['check-ignore', 'canopytag/.active_work.json.lock'], {
      cwd: TEST_DIR,
      encoding: 'utf-8',
    }).trim()).toBe('canopytag/.active_work.json.lock');
    expect(execFileSync('git', ['check-ignore', 'canopytag/.active_work.json.1234.abcd.tmp'], {
      cwd: TEST_DIR,
      encoding: 'utf-8',
    }).trim()).toBe('canopytag/.active_work.json.1234.abcd.tmp');
  });

  it('refuses local-only state that is already tracked', () => {
    execFileSync('git', ['init'], { cwd: TEST_DIR, stdio: 'ignore' });
    const localPath = path.join(TEST_DIR, 'canopytag', '.active_work.json');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, '{}\n');
    execFileSync('git', ['add', 'canopytag/.active_work.json'], { cwd: TEST_DIR, stdio: 'ignore' });

    expect(() => ensureLocalFileIgnored(TEST_DIR, localPath)).toThrow(/tracked by Git/);
  });
});
