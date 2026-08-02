import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { camelToSnake, snakeToCamel } from '../../shared/case-transform.js';
import type {
  ActiveWorkState,
  Canopy,
  WorkClaim,
  WorkClaimPath,
  WorkClaimTodoLink,
} from '../../shared/types.js';
import { parseJsonFile, resolveCanopyDir } from './canopy.js';

export const ACTIVE_WORK_FILENAME = '.active_work.json';
export const DEFAULT_WORK_TTL_SECONDS = 4 * 60 * 60;
export const MIN_WORK_TTL_SECONDS = 60;
export const MAX_WORK_TTL_SECONDS = 7 * 24 * 60 * 60;
export const WORK_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_WORK_HISTORY = 500;

const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 10;

export interface ClaimWorkInput {
  paths: string[];
  owner: string;
  session?: string;
  summary: string;
  ttlSeconds?: number;
  exclusive?: boolean;
  todo?: WorkClaimTodoLink;
  now?: Date;
}

export interface ClaimWorkResult {
  claim?: WorkClaim;
  conflicts: WorkClaim[];
}

export interface WorkClaimView extends WorkClaim {
  derivedState: 'active' | 'expired' | 'released';
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockOwnerAlive(lockPath: string): boolean | undefined {
  try {
    const pid = Number(fs.readFileSync(lockPath, 'utf-8').split(/\s+/, 1)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return error?.code === 'ESRCH' ? false : true;
    }
  } catch {
    return undefined;
  }
}

function atomicWrite(filePath: string, state: ActiveWorkState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(camelToSnake(state), null, 2) + '\n', 'utf-8');
  try {
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function withLock<T>(filePath: string, operation: () => T): T {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let descriptor: number | undefined;
  const token = `${process.pid} ${crypto.randomUUID()} ${new Date().toISOString()}\n`;

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, token, 'utf-8');
      break;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const ownerAlive = lockOwnerAlive(lockPath);
        const oldAndUnowned = Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS
          && ownerAlive !== true;
        if (ownerAlive === false || oldAndUnowned) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch { /* another process may have released the lock */ }
      sleep(LOCK_RETRY_MS);
    }
  }

  if (descriptor === undefined) {
    throw new Error(`Active-work state is busy: ${filePath}. Retry shortly.`);
  }

  try {
    return operation();
  } finally {
    try { fs.closeSync(descriptor); } catch { /* best effort */ }
    try {
      if (fs.readFileSync(lockPath, 'utf-8') === token) fs.rmSync(lockPath, { force: true });
    } catch { /* a stale-lock recovery may already have removed it */ }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStoredClaim(value: unknown, index: number): WorkClaim {
  const label = `${ACTIVE_WORK_FILENAME} claim ${index}`;
  if (!isRecord(value)) throw new Error(`Invalid ${label}: expected an object.`);
  if (typeof value.id !== 'string' || !value.id) throw new Error(`Invalid ${label}: id is required.`);
  if (!Array.isArray(value.paths) || value.paths.length === 0) {
    throw new Error(`Invalid ${label}: paths must be a non-empty array.`);
  }
  for (const claimPath of value.paths) {
    if (!isRecord(claimPath) || typeof claimPath.path !== 'string'
      || !['file', 'directory', 'unknown'].includes(String(claimPath.kind))) {
      throw new Error(`Invalid ${label}: each path needs a path and valid kind.`);
    }
  }
  if (typeof value.owner !== 'string' || !value.owner) throw new Error(`Invalid ${label}: owner is required.`);
  if (typeof value.summary !== 'string' || !value.summary) throw new Error(`Invalid ${label}: summary is required.`);
  if (typeof value.exclusive !== 'boolean') throw new Error(`Invalid ${label}: exclusive must be boolean.`);
  if (value.state !== 'active' && value.state !== 'released') {
    throw new Error(`Invalid ${label}: state must be active or released.`);
  }
  for (const field of ['createdAt', 'updatedAt', 'expiresAt'] as const) {
    if (typeof value[field] !== 'string' || Number.isNaN(Date.parse(value[field] as string))) {
      throw new Error(`Invalid ${label}: ${field} must be an ISO timestamp.`);
    }
  }
  if (value.todo !== undefined && (!isRecord(value.todo)
    || typeof value.todo.file !== 'string' || typeof value.todo.id !== 'string')) {
    throw new Error(`Invalid ${label}: todo must contain file and id.`);
  }
  return value as unknown as WorkClaim;
}

function cleanText(value: string | undefined, label: string): string | undefined {
  const cleaned = value?.trim();
  if (cleaned === '') throw new Error(`${label} cannot be empty.`);
  return cleaned;
}

function validateTtl(ttlSeconds: number | undefined): number {
  const ttl = ttlSeconds ?? DEFAULT_WORK_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < MIN_WORK_TTL_SECONDS || ttl > MAX_WORK_TTL_SECONDS) {
    throw new Error('TTL must be an integer from 60 seconds through 7 days.');
  }
  return ttl;
}

export function resolveActiveWorkPath(repoRoot: string): string {
  return path.join(resolveCanopyDir(repoRoot), ACTIVE_WORK_FILENAME);
}

export function emptyActiveWork(): ActiveWorkState {
  return { version: 1, claims: [] };
}

export function readActiveWork(filePath: string): ActiveWorkState {
  if (!fs.existsSync(filePath)) return emptyActiveWork();
  const raw = snakeToCamel(parseJsonFile(filePath));
  if (!isRecord(raw)) throw new Error(`Invalid ${ACTIVE_WORK_FILENAME}: expected an object.`);
  if (raw.version !== 1) throw new Error(`Unsupported ${ACTIVE_WORK_FILENAME} version: ${String(raw.version)}.`);
  if (!Array.isArray(raw.claims)) throw new Error(`Invalid ${ACTIVE_WORK_FILENAME}: claims must be an array.`);
  return { version: 1, claims: raw.claims.map(validateStoredClaim) };
}

export function normalizeClaimPath(repoRoot: string, candidate: string): WorkClaimPath {
  const trimmed = candidate.trim();
  const directoryHint = /[\\\/]$/.test(trimmed);
  const input = trimmed.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!input || input === '.') throw new Error('Claim path cannot be empty or the repository root.');
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(candidate)) {
    throw new Error(`Claim path must be repository-relative: ${candidate}`);
  }
  if (input.split('/').includes('..')) {
    throw new Error(`Claim path cannot traverse outside the repository: ${candidate}`);
  }
  const absolute = path.resolve(repoRoot, ...input.split('/'));
  const relative = path.relative(repoRoot, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`Claim path leaves the repository: ${candidate}`);
  }
  let kind: WorkClaimPath['kind'] = directoryHint ? 'directory' : 'unknown';
  try {
    const stat = fs.statSync(absolute);
    kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'unknown';
  } catch { /* planned/new paths use exact-match scope */ }
  return { path: relative, kind };
}

function comparablePath(value: string): string {
  return process.platform === 'win32' || process.platform === 'darwin'
    ? value.toLowerCase()
    : value;
}

function pathsOverlap(left: WorkClaimPath, right: WorkClaimPath): boolean {
  const leftPath = comparablePath(left.path);
  const rightPath = comparablePath(right.path);
  if (leftPath === rightPath) return true;
  if (left.kind === 'directory' && rightPath.startsWith(`${leftPath}/`)) return true;
  if (right.kind === 'directory' && leftPath.startsWith(`${rightPath}/`)) return true;
  return false;
}

export function claimsOverlap(left: WorkClaim, right: WorkClaim): boolean {
  return left.paths.some(leftPath => right.paths.some(rightPath => pathsOverlap(leftPath, rightPath)));
}

export function derivedClaimState(claim: WorkClaim, now: Date = new Date()): WorkClaimView['derivedState'] {
  if (claim.state === 'released') return 'released';
  return new Date(claim.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
}

function pruneWorkHistory(state: ActiveWorkState, now: Date): void {
  const cutoff = now.getTime() - WORK_HISTORY_RETENTION_MS;
  const active = state.claims.filter(claim => derivedClaimState(claim, now) === 'active');
  const history = state.claims
    .filter(claim => derivedClaimState(claim, now) !== 'active')
    .filter(claim => {
      const timestamp = claim.state === 'released'
        ? (claim.releasedAt ?? claim.updatedAt)
        : claim.expiresAt;
      return new Date(timestamp).getTime() >= cutoff;
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_WORK_HISTORY);
  state.claims = [...active, ...history];
}

export function listWorkClaims(
  state: ActiveWorkState,
  options: { paths?: string[]; owner?: string; includeHistory?: boolean; now?: Date } = {},
): WorkClaimView[] {
  const now = options.now ?? new Date();
  const pathFilters = options.paths?.map(candidate => comparablePath(
    candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''),
  ));
  return state.claims
    .map(claim => ({ ...claim, derivedState: derivedClaimState(claim, now) }))
    .filter(claim => options.includeHistory || claim.derivedState === 'active')
    .filter(claim => !options.owner || claim.owner === options.owner)
    .filter(claim => !pathFilters?.length || claim.paths.some(claimPath => {
      const claimPathKey = comparablePath(claimPath.path);
      return pathFilters.some(filter => (
        claimPathKey === filter
        || (claimPath.kind === 'directory' && filter.startsWith(`${claimPathKey}/`))
        || claimPathKey.startsWith(`${filter}/`)
      ));
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function currentBranch(repoRoot: string): string | undefined {
  try {
    const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

export function resolveTodoLink(canopy: Canopy, id: string, file?: string): WorkClaimTodoLink {
  const requestedFile = file
    ? comparablePath(file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))
    : undefined;
  const matches = Object.entries(canopy.files)
    .filter(([filePath]) => !requestedFile || comparablePath(filePath) === requestedFile)
    .flatMap(([filePath, card]) => (card.todos ?? [])
      .filter(todo => todo.id === id)
      .map(() => ({ file: filePath, id })));
  if (matches.length === 0) throw new Error(`TODO ${id} was not found${file ? ` in ${file}` : ''}.`);
  if (matches.length > 1) {
    throw new Error(`TODO ${id} is ambiguous; specify its file (${matches.map(match => match.file).join(', ')}).`);
  }
  return matches[0];
}

export function claimWork(
  repoRoot: string,
  filePath: string,
  input: ClaimWorkInput,
): ClaimWorkResult {
  const now = input.now ?? new Date();
  const ttl = validateTtl(input.ttlSeconds);
  const owner = cleanText(input.owner, 'Owner');
  const summary = cleanText(input.summary, 'Summary');
  const session = cleanText(input.session, 'Session');
  if (!owner) throw new Error('Owner is required.');
  if (!summary) throw new Error('Summary is required.');
  const normalizedPaths = [...new Map(
    input.paths.map(candidate => normalizeClaimPath(repoRoot, candidate)).map(item => [item.path, item]),
  ).values()];
  if (normalizedPaths.length === 0) throw new Error('At least one claim path is required.');
  const branch = currentBranch(repoRoot);

  return withLock(filePath, () => {
    const state = readActiveWork(filePath);
    pruneWorkHistory(state, now);
    const prospective: WorkClaim = {
      id: '',
      paths: normalizedPaths,
      owner,
      ...(session ? { session } : {}),
      summary,
      ...(branch ? { branch } : {}),
      exclusive: input.exclusive ?? true,
      state: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      ...(input.todo ? { todo: input.todo } : {}),
    };
    const conflicts = state.claims.filter(claim => (
      derivedClaimState(claim, now) === 'active'
      && (claim.exclusive || prospective.exclusive)
      && claimsOverlap(claim, prospective)
    ));
    if (conflicts.length > 0) return { conflicts };

    prospective.id = `AW-${crypto.randomUUID()}`;
    state.claims.push(prospective);
    atomicWrite(filePath, state);
    return { claim: prospective, conflicts: [] };
  });
}

function sameActor(claim: WorkClaim, owner: string, session?: string): boolean {
  if (claim.owner !== owner) return false;
  return !claim.session || claim.session === session;
}

export function renewWorkClaim(
  filePath: string,
  id: string,
  actor: { owner: string; session?: string; force?: boolean; ttlSeconds?: number; now?: Date },
): WorkClaim {
  const ttl = validateTtl(actor.ttlSeconds);
  const now = actor.now ?? new Date();
  return withLock(filePath, () => {
    const state = readActiveWork(filePath);
    const claim = state.claims.find(candidate => candidate.id === id);
    if (!claim) throw new Error(`Active-work claim not found: ${id}`);
    if (claim.state === 'released') throw new Error(`Active-work claim is already released: ${id}`);
    if (!actor.force && !sameActor(claim, actor.owner, actor.session)) {
      throw new Error(`Claim ${id} belongs to ${claim.owner}; use the matching owner/session or force after review.`);
    }
    if (derivedClaimState(claim, now) === 'expired') {
      throw new Error(`Active-work claim expired: ${id}. Create a new claim so path conflicts are rechecked.`);
    }
    claim.updatedAt = now.toISOString();
    claim.expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
    pruneWorkHistory(state, now);
    atomicWrite(filePath, state);
    return claim;
  });
}

export function releaseWorkClaim(
  filePath: string,
  id: string,
  actor: { owner: string; session?: string; force?: boolean; note?: string; now?: Date },
): WorkClaim {
  const now = actor.now ?? new Date();
  return withLock(filePath, () => {
    const state = readActiveWork(filePath);
    const claim = state.claims.find(candidate => candidate.id === id);
    if (!claim) throw new Error(`Active-work claim not found: ${id}`);
    if (!actor.force && !sameActor(claim, actor.owner, actor.session)) {
      throw new Error(`Claim ${id} belongs to ${claim.owner}; use the matching owner/session or force after review.`);
    }
    if (claim.state !== 'released') {
      claim.state = 'released';
      claim.updatedAt = now.toISOString();
      claim.releasedAt = now.toISOString();
      const note = cleanText(actor.note, 'Release note');
      if (note) claim.releaseNote = note;
      pruneWorkHistory(state, now);
      atomicWrite(filePath, state);
    }
    return claim;
  });
}

export function parseTtl(value: string | undefined): number {
  if (!value) return DEFAULT_WORK_TTL_SECONDS;
  const match = /^(\d+)([mhd])$/.exec(value.trim().toLowerCase());
  if (!match) throw new Error('TTL must use a whole-number duration such as 30m, 4h, or 2d.');
  const amount = Number(match[1]);
  const multiplier = match[2] === 'm' ? 60 : match[2] === 'h' ? 3600 : 86400;
  return validateTtl(amount * multiplier);
}
