import { execFileSync } from 'child_process';

/**
 * Get the last git commit date for a file.
 * Returns ISO date string or undefined if not tracked / git unavailable.
 */
export function getLastModified(repoRoot: string, relativePath: string): string | undefined {
  try {
    const result = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--', relativePath],
      { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 }
    ).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Batch-fetch last modified dates for multiple files.
 * More efficient than calling getLastModified per file for large sets.
 */
export function getLastModifiedBatch(
  repoRoot: string,
  relativePaths: string[]
): Map<string, string> {
  const result = new Map<string, string>();
  // For now, call individually. Can be optimized with git log --name-only later.
  for (const p of relativePaths) {
    const date = getLastModified(repoRoot, p);
    if (date) result.set(p, date);
  }
  return result;
}
