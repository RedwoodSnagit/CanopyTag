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

function appendIgnorePattern(targetPath: string, pattern: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
  const lines = existing.split(/\r?\n/).map(line => line.trim());
  if (lines.includes(pattern)) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const comment = lines.includes('# CanopyTag local identity') ? '' : '# CanopyTag local identity\n';
  fs.appendFileSync(targetPath, `${prefix}${comment}${pattern}\n`, 'utf-8');
}

function hasIgnorePattern(targetPath: string, pattern: string): boolean {
  if (!fs.existsSync(targetPath)) return false;
  const lines = fs.readFileSync(targetPath, 'utf-8').split(/\r?\n/).map(line => line.trim());
  return lines.includes(pattern);
}

export function ensureProfileIgnored(repoRoot: string, profilePath: string = resolveProfilePath(repoRoot)): void {
  const relative = path.relative(repoRoot, profilePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) return;

  const repoGitignore = path.join(repoRoot, '.gitignore');
  if (hasIgnorePattern(repoGitignore, relative)) return;

  const gitInfoDir = path.join(repoRoot, '.git', 'info');
  const ignorePath = fs.existsSync(gitInfoDir)
    ? path.join(gitInfoDir, 'exclude')
    : repoGitignore;

  appendIgnorePattern(ignorePath, relative);
}
