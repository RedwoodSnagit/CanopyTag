import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const QUERY_CLI = path.join(REPO_ROOT, 'src', 'cli', 'query.ts');

describe('query CLI option parsing', () => {
  it('fails clearly for unknown options', () => {
    const result = spawnSync(process.execPath, [TSX_CLI, QUERY_CLI, '--definitely-unknown'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid query options:');
    expect(result.stderr).toContain('Unknown option');
    expect(result.stdout).toBe('');
  });
});
