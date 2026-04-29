import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hookScript = path.resolve('hooks/canopytag-analytics.mjs');

function makeRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canopytag-hook-'));
  const canopyDir = path.join(repoRoot, 'canopytag');
  fs.mkdirSync(canopyDir, { recursive: true });
  fs.writeFileSync(path.join(canopyDir, 'canopy.json'), JSON.stringify({
    version: 1,
    repo_root: '.',
    files: {},
    features: {},
  }));
  fs.writeFileSync(path.join(canopyDir, 'settings.json'), JSON.stringify({
    analytics_enabled: true,
  }));
  return repoRoot;
}

function runHook(repoRoot: string, payload: unknown) {
  const result = spawnSync(process.execPath, [hookScript], {
    cwd: repoRoot,
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
  expect(result.status).toBe(0);
}

function readAnalytics(repoRoot: string): any {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'canopytag', '.analytics.json'), 'utf-8'));
}

describe('canopytag analytics hook search tracking', () => {
  it('records Grep result files as search heat without counting them as opened', () => {
    const repoRoot = makeRepo();
    try {
      runHook(repoRoot, {
        tool_name: 'Grep',
        tool_input: { pattern: 'habitat' },
        tool_response: 'src/utils.py:10:def habitat_value():\ndocs/README.md:4:habitat notes',
      });

      const analytics = readAnalytics(repoRoot);
      const today = new Date().toISOString().slice(0, 10);

      expect(analytics.daily[today].grepCount).toBe(1);
      expect(analytics.daily[today].uniqueFilesAccessed).toBe(0);
      expect(analytics.files['src/utils.py'].days[today].grepHitCount).toBe(1);
      expect(analytics.files['docs/README.md'].days[today].grepHitCount).toBe(1);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('records Glob result files as search heat', () => {
    const repoRoot = makeRepo();
    try {
      runHook(repoRoot, {
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.py' },
        tool_response: ['src/main.py', 'tests/test_main.py'],
      });

      const analytics = readAnalytics(repoRoot);
      const today = new Date().toISOString().slice(0, 10);

      expect(analytics.daily[today].globCount).toBe(1);
      expect(analytics.files['src/main.py'].days[today].globHitCount).toBe(1);
      expect(analytics.files['tests/test_main.py'].days[today].globHitCount).toBe(1);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('records Bash ripgrep invocations separately from Claude Grep', () => {
    const repoRoot = makeRepo();
    try {
      runHook(repoRoot, {
        tool_name: 'Bash',
        tool_input: { command: 'rg TODO src tests' },
        tool_response: { stdout: 'src/main.py:15:# TODO\ntests/test_main.py:20:# TODO' },
      });

      const analytics = readAnalytics(repoRoot);
      const today = new Date().toISOString().slice(0, 10);

      expect(analytics.daily[today].grepCount).toBe(0);
      expect(analytics.daily[today].ripgrepCount).toBe(1);
      expect(analytics.files['src/main.py'].days[today].ripgrepHitCount).toBe(1);
      expect(analytics.files['tests/test_main.py'].days[today].ripgrepHitCount).toBe(1);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('reads canopy and settings metadata with a UTF-8 BOM', () => {
    const repoRoot = makeRepo();
    try {
      const canopyDir = path.join(repoRoot, 'canopytag');
      fs.writeFileSync(path.join(canopyDir, 'canopy.json'), '\uFEFF' + JSON.stringify({
        version: 1,
        repo_root: '.',
        files: {},
        features: {},
      }));
      fs.writeFileSync(path.join(canopyDir, 'settings.json'), '\uFEFF' + JSON.stringify({
        analytics_enabled: true,
      }));

      runHook(repoRoot, {
        tool_name: 'Read',
        tool_input: { file_path: path.join(repoRoot, 'src', 'main.py') },
      });

      const analytics = readAnalytics(repoRoot);
      const today = new Date().toISOString().slice(0, 10);

      expect(analytics.files['src/main.py'].days[today].readCount).toBe(1);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
