import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { readCanopy, readSettings, readArchive, writeCanopy, writeArchive, runArchiveSweep, ensureCommentIds, resolveCanopyDir } from './lib/canopy';
import { ensureProfileIgnored, readOrCreateProfile, resolveProfilePath } from './lib/profile';
import { snakeToCamel } from '../shared/case-transform';
import type { Canopy, RepoIndexItem, CanopySettings, CanopyProfile } from '../shared/types';

import { treeRoutes } from './routes/tree';
import { fileRoutes } from './routes/file';
import { indexRoutes } from './routes/index';
import { todoRoutes } from './routes/todo';
import { commentRoutes } from './routes/comment';
import { featuresRoutes } from './routes/features';
import { rescanRoutes } from './routes/rescan';
import { tagsRoutes } from './routes/tags';
import { agentNotesRoutes } from './routes/agent-notes';
import { directoryRoutes } from './routes/directory';
import { settingsRoutes } from './routes/settings';
import { archiveRoutes } from './routes/archive';
import { configRoutes } from './routes/config';
import { analyticsRoutes } from './routes/analytics.js';
import { manifestRoutes } from './routes/manifest.js';
import { profileRoutes } from './routes/profile.js';

// ---- Type augmentation for Fastify decorator ----

interface ServerState {
  repoRoot: string;
  canopyPath: string;
  canopy: Canopy;
  repoIndex: Map<string, RepoIndexItem>;
  tags: string[];
  settings: CanopySettings;
  settingsPath: string;
  profile: CanopyProfile;
  profilePath: string;
  archivePath: string;
  analyticsPath: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    serverState: ServerState;
  }
}

// ---- CLI args ----

const { values: args } = parseArgs({
  options: {
    repo: { type: 'string', short: 'r' },
    port: { type: 'string', short: 'p' },
  },
  strict: false,
});

// ---- Bootstrap ----

const serverDir = import.meta.dirname;

// Resolve repo root: CLI arg > env var > default
const explicitRoot = (typeof args.repo === 'string' ? args.repo : undefined)
  ?? process.env.REPO_ROOT;

let repoRoot: string;
if (explicitRoot) {
  repoRoot = explicitRoot;
} else {
  // serverDir is src/backend — go up 2 levels to reach the CanopyTag project root
  const canopyTagRoot = path.resolve(serverDir, '../..');
  const canopyTagPkg = path.join(canopyTagRoot, 'package.json');
  let isCanopyTagInstall = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(canopyTagPkg, 'utf-8'));
    isCanopyTagInstall = pkg.name === 'canopytag';
  } catch {
    // Not a CanopyTag install
  }

  if (isCanopyTagInstall) {
    // Running from CanopyTag itself — use the bundled demo workspace
    repoRoot = path.join(canopyTagRoot, 'demo');
  } else {
    // Running as a dependency — default to the parent project root
    repoRoot = path.resolve(canopyTagRoot, '..');
  }
}

const canopyDir = resolveCanopyDir(repoRoot);
const canopyPath = path.join(canopyDir, 'canopy.json');
const settingsPath = path.join(canopyDir, 'settings.json');
const archivePath = path.join(canopyDir, 'canopy_archive.json');
const analyticsPath = path.join(canopyDir, '.analytics.json');
const settings = readSettings(settingsPath);

if (!fs.existsSync(canopyDir)) {
  fs.mkdirSync(canopyDir, { recursive: true });
  console.log(`[canopytag] Created ${canopyDir}`);
}

const profilePath = resolveProfilePath(repoRoot);
ensureProfileIgnored(repoRoot, profilePath);
const profile = readOrCreateProfile(profilePath, repoRoot);

console.log(`[canopytag] repoRoot  = ${repoRoot}`);
console.log(`[canopytag] canopy    = ${canopyPath}`);
console.log(`[canopytag] profile   = ${profilePath}`);

// Load canopy
const canopy = readCanopy(canopyPath);
ensureCommentIds(canopy);

// Load repo_index.json (optional — legacy enrichment from prior repo)
const repoIndex = new Map<string, RepoIndexItem>();
const indexPath = path.join(repoRoot, 'docs', '_meta', 'repo_index.json');
if (fs.existsSync(indexPath)) {
  const rawIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const items: RepoIndexItem[] = snakeToCamel(rawIndex.items);
  for (const item of items) {
    repoIndex.set(item.path, item);
  }
  console.log(`[canopytag] Loaded ${repoIndex.size} items from repo_index.json (optional)`);
}

// Load tags — check <canopyDir>/tags.json first, then fall back to legacy tag_policy.json,
// then extract unique tags from existing canopy data
let tags: string[] = [];
const canopyTagsPath = path.join(canopyDir, 'tags.json');
const legacyTagPolicyPath = path.join(repoRoot, 'docs', 'tag_policy.json');

if (fs.existsSync(canopyTagsPath)) {
  const tagData = JSON.parse(fs.readFileSync(canopyTagsPath, 'utf-8'));
  tags = Array.isArray(tagData) ? tagData : Object.keys(tagData.tags ?? tagData);
  console.log(`[canopytag] Loaded ${tags.length} tags from ${path.relative(repoRoot, canopyTagsPath)}`);
} else if (fs.existsSync(legacyTagPolicyPath)) {
  const tagPolicy = JSON.parse(fs.readFileSync(legacyTagPolicyPath, 'utf-8'));
  tags = Object.keys(tagPolicy.tags);
  console.log(`[canopytag] Loaded ${tags.length} tags from tag_policy.json (legacy)`);
} else {
  // Extract unique tags from canopy data
  const tagSet = new Set<string>();
  for (const file of Object.values(canopy.files)) {
    for (const tag of file.tags ?? []) {
      tagSet.add(tag);
    }
  }
  tags = Array.from(tagSet).sort();
  console.log(`[canopytag] Extracted ${tags.length} tags from canopy data`);
}

// ---- Create server ----

const app = Fastify({ logger: false });

await app.register(cors, { origin: ['http://localhost:5180'], methods: ['GET', 'POST', 'PUT', 'DELETE'] });

// Decorate with shared state
app.decorate('serverState', {
  repoRoot,
  canopyPath,
  canopy,
  repoIndex,
  tags,
  settings,
  settingsPath,
  profile,
  profilePath,
  archivePath,
  analyticsPath,
} satisfies ServerState);

// Register routes
await app.register(treeRoutes);
await app.register(fileRoutes);
await app.register(indexRoutes);
await app.register(todoRoutes);
await app.register(commentRoutes);
await app.register(featuresRoutes);
await app.register(rescanRoutes);
await app.register(tagsRoutes);
await app.register(agentNotesRoutes);
await app.register(directoryRoutes);
await app.register(settingsRoutes);
await app.register(archiveRoutes);
await app.register(configRoutes);
await app.register(analyticsRoutes);
await app.register(manifestRoutes);
await app.register(profileRoutes);

// ---- Startup archive sweep ----

{
  const archive = readArchive(archivePath);
  const { canopy: swept, archive: updated, swept: count } = runArchiveSweep(canopy, archive, settings.archiveRetention);
  if (count > 0) {
    writeCanopy(canopyPath, swept);
    writeArchive(archivePath, updated);
    console.log(`[canopytag] Archived ${count} completed TODOs`);
  }
}

// ---- Start ----

const PORT = Number(typeof args.port === 'string' ? args.port : '') || 3100;
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[canopytag] Server listening on http://localhost:${PORT}`);
} catch (err) {
  console.error('[canopytag] Failed to start:', err);
  process.exit(1);
}
