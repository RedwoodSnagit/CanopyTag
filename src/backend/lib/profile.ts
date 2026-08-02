import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snakeToCamel, camelToSnake } from '../../shared/case-transform';
import type { Author, AuthorSignature, CanopyProfile } from '../../shared/types';
import { normalizeAuthor } from '../../shared/types';
import { parseJsonFile, resolveCanopyDir } from './canopy';

export const PROFILE_FILENAME = 'profile.local.json';

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function gitConfig(repoRoot: string | undefined, key: string): string | undefined {
  if (!repoRoot) return undefined;
  try {
    return clean(execFileSync(
      'git',
      ['-C', repoRoot, 'config', '--get', key],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ));
  } catch {
    return undefined;
  }
}

function osUsername(): string | undefined {
  try {
    return clean(os.userInfo().username);
  } catch {
    return undefined;
  }
}

export function resolveProfilePath(repoRoot: string): string {
  return path.join(resolveCanopyDir(repoRoot), PROFILE_FILENAME);
}

export function detectHumanAuthor(repoRoot?: string): AuthorSignature {
  const name =
    clean(process.env.CANOPYTAG_AUTHOR_NAME) ??
    clean(process.env.CANOPYTAG_USER_NAME) ??
    gitConfig(repoRoot, 'user.name') ??
    clean(process.env.GIT_AUTHOR_NAME) ??
    clean(process.env.USERNAME) ??
    clean(process.env.USER) ??
    osUsername();

  return {
    role: 'human',
    ...(name ? { name } : {}),
  };
}

export function sanitizeHumanAuthor(author: Author | Partial<AuthorSignature> | undefined, repoRoot?: string): AuthorSignature {
  const fallback = detectHumanAuthor(repoRoot);
  const normalized = author
    ? (typeof author === 'string' ? normalizeAuthor(author) : author)
    : fallback;
  const name = clean(normalized.name) ?? fallback.name;
  const session = clean(normalized.session);

  return {
    role: 'human',
    ...(name ? { name } : {}),
    ...(session ? { session } : {}),
  };
}

function normalizeProfile(raw: unknown, repoRoot?: string): CanopyProfile {
  const parsed = snakeToCamel(raw) as Partial<CanopyProfile> & {
    author?: Author;
    currentAuthor?: Author;
  };
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    currentAuthor: sanitizeHumanAuthor(parsed.currentAuthor ?? parsed.author, repoRoot),
  };
}

export function readProfile(profilePath: string, repoRoot?: string): CanopyProfile {
  if (!fs.existsSync(profilePath)) {
    return {
      version: 1,
      currentAuthor: detectHumanAuthor(repoRoot),
    };
  }

  const raw = parseJsonFile(profilePath);
  return normalizeProfile(raw, repoRoot);
}

export function writeProfile(profilePath: string, profile: CanopyProfile): CanopyProfile {
  const validated: CanopyProfile = {
    version: typeof profile.version === 'number' ? profile.version : 1,
    currentAuthor: sanitizeHumanAuthor(profile.currentAuthor),
  };
  atomicWrite(profilePath, JSON.stringify(camelToSnake(validated), null, 2) + '\n');
  return validated;
}

export function readOrCreateProfile(profilePath: string, repoRoot?: string): CanopyProfile {
  const profile = readProfile(profilePath, repoRoot);
  if (!fs.existsSync(profilePath)) {
    writeProfile(profilePath, profile);
  }
  return profile;
}

function appendIgnorePattern(targetPath: string, pattern: string, commentText: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
  const lines = existing.split(/\r?\n/).map(line => line.trim());
  if (lines.includes(pattern)) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const comment = lines.includes(commentText) ? '' : `${commentText}\n`;
  fs.appendFileSync(targetPath, `${prefix}${comment}${pattern}\n`, 'utf-8');
}

function hasIgnorePattern(targetPath: string, pattern: string): boolean {
  if (!fs.existsSync(targetPath)) return false;
  const lines = fs.readFileSync(targetPath, 'utf-8').split(/\r?\n/).map(line => line.trim());
  return lines.includes(pattern);
}

function gitPath(repoRoot: string, ...gitArguments: string[]): string | undefined {
  try {
    const result = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--path-format=absolute', ...gitArguments],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000 },
    ).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

function gitCommandSucceeds(repoRoot: string, ...gitArguments: string[]): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, ...gitArguments], {
      stdio: 'ignore',
      timeout: 2_000,
    });
    return true;
  } catch {
    return false;
  }
}

function gitIgnoresLocalState(repoRoot: string, relative: string, patternSuffix: string): boolean {
  const candidates = [relative];
  if (patternSuffix === '*') {
    candidates.push(`${relative}.lock`, `${relative}.1234.abcd.tmp`);
  } else if (patternSuffix) {
    candidates.push(`${relative}${patternSuffix}`);
  }
  return candidates.every(candidate => gitCommandSucceeds(
    repoRoot,
    'check-ignore',
    '-q',
    '--',
    candidate,
  ));
}

export function ensureLocalFileIgnored(
  repoRoot: string,
  filePath: string,
  commentText = '# CanopyTag local state',
  patternSuffix = '',
): void {
  const relative = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) return;
  const ignorePattern = `${relative}${patternSuffix}`;

  const repoGitignore = path.join(repoRoot, '.gitignore');
  const gitTopLevel = gitPath(repoRoot, '--show-toplevel');
  const resolvedGitTopLevel = gitTopLevel ? path.resolve(gitTopLevel) : undefined;
  const resolvedRepoRoot = path.resolve(repoRoot);
  const isWorktreeRoot = gitTopLevel !== undefined
    && (process.platform === 'win32' || process.platform === 'darwin'
      ? resolvedGitTopLevel?.toLowerCase() === resolvedRepoRoot.toLowerCase()
      : resolvedGitTopLevel === resolvedRepoRoot);
  const gitExclude = isWorktreeRoot
    ? gitPath(repoRoot, '--git-path', 'info/exclude')
    : undefined;
  if (gitExclude) {
    if (gitCommandSucceeds(repoRoot, 'ls-files', '--error-unmatch', '--', relative)) {
      throw new Error(`${relative} is tracked by Git and cannot be used as local-only CanopyTag state.`);
    }
    if (gitIgnoresLocalState(repoRoot, relative, patternSuffix)) return;
  } else if (hasIgnorePattern(repoGitignore, ignorePattern)) {
    return;
  }

  const ignorePath = gitExclude ?? repoGitignore;

  appendIgnorePattern(ignorePath, ignorePattern, commentText);

  if (gitExclude && !gitIgnoresLocalState(repoRoot, relative, patternSuffix)) {
    throw new Error(`Could not verify that local CanopyTag state is ignored: ${relative}`);
  }
}

export function ensureProfileIgnored(repoRoot: string, profilePath: string = resolveProfilePath(repoRoot)): void {
  ensureLocalFileIgnored(repoRoot, profilePath, '# CanopyTag local identity');
}
