#!/usr/bin/env node
/**
 * canopytag init — initialize a repo for annotation
 *
 * Creates the canopytag/ directory with canopy.json, agent_manifest.json,
 * settings.json, and a git-ignored profile.local.json.
 * Safe to run on an already-initialized repo — prints status without overwriting.
 *
 * Usage:
 *   canopytag init                        # initialize current directory
 *   canopytag init --repo /path/to/repo   # initialize a specific repo
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { writeCanopy, writeSettings } from '../backend/lib/canopy.js';
import { emptyAgentManifest, resolveAgentManifestPath, writeAgentManifest } from '../backend/lib/agent-manifest.js';
import { ensureProfileIgnored, readOrCreateProfile, resolveProfilePath } from '../backend/lib/profile.js';
import { resolveRepoRoot, resolveCanopyPath, CORE_OPTIONS } from './shared.js';
import type { Canopy } from '../shared/types.js';

const { values } = parseArgs({
  options: {
    ...CORE_OPTIONS,
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`canopytag init — initialize a repo for annotation

Usage:
  canopytag init [--repo <path>]

Options:
  --repo, -r  Path to the repo to initialize (default: current directory)
  --help, -h  Show this help

Creates canopytag/canopy.json, canopytag/agent_manifest.json,
canopytag/settings.json, and a git-ignored canopytag/profile.local.json
in the target repo.
Safe to run on an already-initialized repo — prints status without overwriting.
`);
  process.exit(0);
}

const repoRoot = resolveRepoRoot(values.repo as string | undefined);
const canopyJsonPath = resolveCanopyPath(values.repo as string | undefined);
const canopyDir = path.dirname(canopyJsonPath);
const settingsPath = path.join(canopyDir, 'settings.json');
const manifestPath = resolveAgentManifestPath(values.repo as string | undefined);
const profilePath = resolveProfilePath(repoRoot);

// Check if already initialized (resolveCanopyPath checks both canopytag/ and .canopytag/)
if (fs.existsSync(canopyJsonPath)) {
  const stat = fs.statSync(canopyJsonPath);
  ensureProfileIgnored(repoRoot, profilePath);
  readOrCreateProfile(profilePath, repoRoot);
  process.stdout.write(`Already initialized: ${canopyDir}\n`);
  process.stdout.write(`  canopy.json    ${(stat.size / 1024).toFixed(1)} KB\n`);
  process.stdout.write(`  settings.json  ${fs.existsSync(settingsPath) ? 'present' : 'not found'}\n`);
  process.stdout.write(`  agent_manifest.json  ${fs.existsSync(manifestPath) ? 'present' : 'not found'}\n`);
  process.stdout.write(`  profile.local.json   ${fs.existsSync(profilePath) ? 'present (git-ignored)' : 'not found'}\n`);
  process.stdout.write(`\nRun canopytag stats to see what's been annotated.\n`);
  process.exit(0);
}

// Create directory if needed
if (!fs.existsSync(canopyDir)) {
  fs.mkdirSync(canopyDir, { recursive: true });
}

// Write empty canopy.json
const empty: Canopy = {
  version: 1,
  repoRoot: '',
  lastModifiedAt: '',
  files: {},
  features: {},
};
writeCanopy(canopyJsonPath, empty);

// Write default settings.json
if (!fs.existsSync(settingsPath)) {
  writeSettings(settingsPath, { archiveRetention: '7d' });
}

// Write empty agent_manifest.json
if (!fs.existsSync(manifestPath)) {
  writeAgentManifest(manifestPath, emptyAgentManifest());
}

// Write local human profile and ignore it. This is intentionally not shared
// project metadata; it prevents cloned repos from inheriting another user.
ensureProfileIgnored(repoRoot, profilePath);
readOrCreateProfile(profilePath, repoRoot);

// Print result
const repoName = path.basename(repoRoot);
process.stdout.write(`Initialized ${repoName}\n`);
process.stdout.write(`  ${canopyJsonPath}\n`);
process.stdout.write(`  ${settingsPath}\n`);
process.stdout.write(`  ${manifestPath}\n`);
process.stdout.write(`  ${profilePath} (local, git-ignored)\n\n`);
process.stdout.write(`Next steps:\n`);
process.stdout.write(`  canopytag stats --repo ${repoRoot}   # check annotation status\n`);
process.stdout.write(`  canopytag ls --repo ${repoRoot}       # browse annotated files\n`);
process.stdout.write(`  canopytag mcp --repo ${repoRoot}      # write ${path.join(repoRoot, '.mcp.json')}\n`);
process.stdout.write(`\nNote: if you later generate MCP or hook config, review local absolute paths before sharing a public repo.\n`);
process.stdout.write(`\nTo annotate files, use the web UI (canopytag serve) or MCP tools.\n`);
process.stdout.write(`Agents can populate canopy.json via canopytag_annotate or stage suggestions in agent_manifest.json via canopytag_stage_suggestion.\n`);
