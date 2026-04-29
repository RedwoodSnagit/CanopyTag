import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectHumanAuthor,
  ensureProfileIgnored,
  readOrCreateProfile,
  readProfile,
  writeProfile,
} from '../lib/profile';

const TEST_DIR = path.join(import.meta.dirname, '__test_profile_workspace__');

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.CANOPYTAG_AUTHOR_NAME;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
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
});
