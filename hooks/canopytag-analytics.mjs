#!/usr/bin/env node
// CanopyTag PostToolUse analytics hook.
// Called by Claude Code after Read/Edit/Write/Grep/Glob/Bash tool invocations.
// Reads from stdin, writes to <canopyDir>/.analytics.json. Zero output. Always exit 0.

import fs from 'node:fs';
import path from 'node:path';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

// ---- Helpers ----

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

function resolveCanopyDir(cwd) {
  const unhidden = path.join(cwd, 'canopytag');
  if (existsSync(path.join(unhidden, 'canopy.json'))) return unhidden;
  return null;
}

function emptyAnalytics() {
  return { version: 1, files: {}, daily: {} };
}

function emptyTotal() {
  return {
    readCount: 0,
    editCount: 0,
    writeCount: 0,
    canopyQueryCount: 0,
    grepHitCount: 0,
    globHitCount: 0,
    ripgrepHitCount: 0,
  };
}

function emptyDaily() {
  return { grepCount: 0, globCount: 0, ripgrepCount: 0, uniqueFilesAccessed: 0 };
}

function incrementFile(analytics, filePath, field, date) {
  const now = nowIso();
  if (!analytics.files[filePath]) {
    analytics.files[filePath] = {
      total: emptyTotal(),
      days: {},
      firstAccessedAt: now,
      lastAccessedAt: now,
    };
  }
  const fa = analytics.files[filePath];
  fa.total[field] = (fa.total[field] ?? 0) + 1;
  fa.lastAccessedAt = now;
  if (!fa.days[date]) fa.days[date] = {};
  fa.days[date][field] = (fa.days[date][field] ?? 0) + 1;

  // Search results are attention signals, not direct file opens.
  if (field === 'grepHitCount' || field === 'globHitCount' || field === 'ripgrepHitCount') {
    return;
  }

  // Increment uniqueFilesAccessed on first direct event for this file today
  const b = fa.days[date];
  const total = (b.readCount ?? 0) + (b.editCount ?? 0) + (b.writeCount ?? 0) + (b.canopyQueryCount ?? 0);
  if (total === 1) {
    if (!analytics.daily[date]) analytics.daily[date] = emptyDaily();
    analytics.daily[date].uniqueFilesAccessed += 1;
  }
}

function incrementDaily(analytics, field, date) {
  if (!analytics.daily[date]) analytics.daily[date] = emptyDaily();
  analytics.daily[date][field] = (analytics.daily[date][field] ?? 0) + 1;
}

function isRipgrepCommand(command) {
  return /(^|[\s;&|()])(?:rg|rg\.exe|ripgrep|ripgrep\.exe)(?=$|[\s;&|()])/.test(command);
}

function normalizeRepoRelativePath(rawPath, repoRoot) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  let candidate = rawPath.trim()
    .replace(/^["'`]+|["'`,;]+$/g, '')
    .replace(/\\/g, '/');

  candidate = candidate.replace(/:(\d+)(?::\d+)?$/, '');
  if (
    !candidate ||
    candidate.startsWith('http://') ||
    candidate.startsWith('https://') ||
    /\s|[{}()[\]=]/.test(candidate)
  ) return null;

  if (path.isAbsolute(candidate) || /^[A-Za-z]:\//.test(candidate)) {
    const absolute = path.resolve(candidate).replace(/\\/g, '/');
    if (!absolute.startsWith(repoRoot)) return null;
    candidate = absolute.slice(repoRoot.length).replace(/^\//, '');
  } else {
    candidate = candidate.replace(/^\.\//, '');
  }

  if (
    !candidate ||
    candidate.startsWith('../') ||
    candidate.startsWith('canopytag/') ||
    (!candidate.includes('/') && !candidate.includes('.')) ||
    candidate.includes('\0')
  ) {
    return null;
  }

  return candidate;
}

function addCandidate(paths, candidate, repoRoot) {
  const normalized = normalizeRepoRelativePath(candidate, repoRoot);
  if (normalized) paths.add(normalized);
}

function addLineCandidates(paths, line, repoRoot) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const absoluteRegex = /(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>|]+/g;
  for (const match of trimmed.matchAll(absoluteRegex)) {
    addCandidate(paths, match[0], repoRoot);
  }

  const rgPrefix = trimmed.match(/^(.+?)(?::\d+)?(?::\d+)?:/);
  if (rgPrefix?.[1]) {
    addCandidate(paths, rgPrefix[1], repoRoot);
  }

  if (!trimmed.includes(' ') && !trimmed.includes('\t')) {
    addCandidate(paths, trimmed, repoRoot);
  }
}

function collectResultText(value, blobs, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    blobs.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectResultText(item, blobs, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'tool_input' || key === 'pattern' || key === 'command') continue;
      collectResultText(child, blobs, depth + 1);
    }
  }
}

function extractResultPaths(payload, repoRoot) {
  const blobs = [];
  for (const key of ['tool_response', 'tool_output', 'response', 'output', 'stdout', 'stderr', 'result', 'results', 'content']) {
    if (payload[key] !== undefined) {
      collectResultText(payload[key], blobs);
    }
  }

  const paths = new Set();
  for (const blob of blobs) {
    for (const line of blob.split(/\r?\n/)) {
      addLineCandidates(paths, line, repoRoot);
    }
  }
  return paths;
}

// ---- Main ----

let payload;
try {
  const stdin = readFileSync(0, 'utf-8');  // fd 0 = stdin, works on Windows + Unix
  payload = JSON.parse(stdin.replace(/^\uFEFF/, ''));
} catch {
  process.exit(0);
}

const cwd = process.cwd();
const canopyDir = resolveCanopyDir(cwd);
if (!canopyDir) process.exit(0);

// Check analyticsEnabled (settings stored as snake_case on disk)
const settings = readJson(path.join(canopyDir, 'settings.json'));
if (settings && settings.analytics_enabled === false) process.exit(0);

const toolName = payload.tool_name;
const toolInput = payload.tool_input ?? {};
const analyticsPath = path.join(canopyDir, '.analytics.json');
const date = today();

// Get repoRoot from canopy.json (stored as repo_root on disk).
// repo_root may be "." or another relative path — resolve it against cwd.
const canopyData = readJson(path.join(canopyDir, 'canopy.json'));
const rawRepoRoot = canopyData?.repo_root ?? cwd;
const repoRoot = path.resolve(cwd, rawRepoRoot).replace(/\\/g, '/');

const analytics = readJson(analyticsPath) ?? emptyAnalytics();

if (toolName === 'Grep') {
  incrementDaily(analytics, 'grepCount', date);
  for (const filePath of extractResultPaths(payload, repoRoot)) {
    incrementFile(analytics, filePath, 'grepHitCount', date);
  }
} else if (toolName === 'Glob') {
  incrementDaily(analytics, 'globCount', date);
  for (const filePath of extractResultPaths(payload, repoRoot)) {
    incrementFile(analytics, filePath, 'globHitCount', date);
  }
} else if (toolName === 'Bash' && isRipgrepCommand(String(toolInput.command ?? ''))) {
  incrementDaily(analytics, 'ripgrepCount', date);
  for (const filePath of extractResultPaths(payload, repoRoot)) {
    incrementFile(analytics, filePath, 'ripgrepHitCount', date);
  }
} else {
  const fieldMap = { Read: 'readCount', Edit: 'editCount', Write: 'writeCount' };
  const field = fieldMap[toolName];
  if (!field) process.exit(0);

  const rawPath = toolInput.file_path;
  if (!rawPath) process.exit(0);

  const normalizedPath = rawPath.replace(/\\/g, '/');
  if (!normalizedPath.startsWith(repoRoot)) process.exit(0);

  // Make path relative to repoRoot
  const relativePath = normalizedPath.slice(repoRoot.length).replace(/^\//, '');
  incrementFile(analytics, relativePath, field, date);
}

try {
  atomicWrite(analyticsPath, analytics);
} catch {
  try {
    fs.mkdirSync(canopyDir, { recursive: true });
    atomicWrite(analyticsPath, analytics);
  } catch { /* silent */ }
}

process.exit(0);
