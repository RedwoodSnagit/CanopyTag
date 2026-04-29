import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { readCanopy, readSettings, readArchive, writeCanopy, writeArchive, runArchiveSweep, ensureCommentIds, resolveCanopyDir, parseJsonFile } from '../lib/canopy';
import { ensureProfileIgnored, readOrCreateProfile, resolveProfilePath } from '../lib/profile';
import { snakeToCamel } from '../../shared/case-transform';
import type { RepoIndexItem } from '../../shared/types';

export async function configRoutes(app: FastifyInstance) {
  // GET /api/config — returns current repo info
  app.get('/api/config', async () => {
    const { repoRoot } = app.serverState;
    const isDemo = repoRoot.endsWith('/demo') || repoRoot.endsWith('\\demo');
    return {
      repoRoot,
      repoName: isDemo ? 'forest_repo_demo' : path.basename(repoRoot),
      isDemo,
    };
  });

  // POST /api/config/repo — switch to a different repo root
  app.post<{ Body: { path: string } }>('/api/config/repo', async (req, reply) => {
    const newRoot = req.body.path;

    // Validate path exists and is a directory
    if (!fs.existsSync(newRoot)) {
      return reply.status(400).send({ error: 'Path does not exist' });
    }
    const stat = fs.statSync(newRoot);
    if (!stat.isDirectory()) {
      return reply.status(400).send({ error: 'Path is not a directory' });
    }

    // Resolve canopy dir: prefer unhidden canopytag/, fall back to legacy .canopytag/
    const canopyDir = resolveCanopyDir(newRoot);
    if (!fs.existsSync(canopyDir)) {
      fs.mkdirSync(canopyDir, { recursive: true });
    }

    const canopyPath = path.join(canopyDir, 'canopy.json');
    const settingsPath = path.join(canopyDir, 'settings.json');
    const archivePath = path.join(canopyDir, 'canopy_archive.json');
    const analyticsPath = path.join(canopyDir, '.analytics.json');
    const profilePath = resolveProfilePath(newRoot);

    // Load canopy data for the new repo
    const canopy = readCanopy(canopyPath);
    ensureCommentIds(canopy);
    const settings = readSettings(settingsPath);
    ensureProfileIgnored(newRoot, profilePath);
    const profile = readOrCreateProfile(profilePath, newRoot);

    // Load repo index (optional)
    const repoIndex = new Map<string, RepoIndexItem>();
    const indexPath = path.join(newRoot, 'docs', '_meta', 'repo_index.json');
    if (fs.existsSync(indexPath)) {
      const rawIndex = parseJsonFile(indexPath) as { items: unknown };
      const items = snakeToCamel(rawIndex.items) as RepoIndexItem[];
      for (const item of items) {
        repoIndex.set(item.path, item);
      }
    }

    // Load tags
    let tags: string[] = [];
    const canopyTagsPath = path.join(canopyDir, 'tags.json');
    const legacyTagPolicyPath = path.join(newRoot, 'docs', 'tag_policy.json');
    if (fs.existsSync(canopyTagsPath)) {
      const tagData = parseJsonFile(canopyTagsPath) as any;
      tags = Array.isArray(tagData) ? tagData : Object.keys(tagData.tags ?? tagData);
    } else if (fs.existsSync(legacyTagPolicyPath)) {
      const tagPolicy = parseJsonFile(legacyTagPolicyPath) as any;
      tags = Object.keys(tagPolicy.tags);
    } else {
      const tagSet = new Set<string>();
      for (const file of Object.values(canopy.files)) {
        for (const tag of file.tags ?? []) {
          tagSet.add(tag);
        }
      }
      tags = Array.from(tagSet).sort();
    }

    // Run archive sweep
    const archive = readArchive(archivePath);
    const { canopy: swept, archive: updated, swept: count } = runArchiveSweep(canopy, archive, settings.archiveRetention);
    if (count > 0) {
      writeCanopy(canopyPath, swept);
      writeArchive(archivePath, updated);
    }

    // Update server state
    app.serverState.repoRoot = newRoot;
    app.serverState.canopyPath = canopyPath;
    app.serverState.canopy = count > 0 ? swept : canopy;
    app.serverState.repoIndex = repoIndex;
    app.serverState.tags = tags;
    app.serverState.settings = settings;
    app.serverState.settingsPath = settingsPath;
    app.serverState.profile = profile;
    app.serverState.profilePath = profilePath;
    app.serverState.archivePath = archivePath;
    app.serverState.analyticsPath = analyticsPath;

    console.log(`[canopytag] Switched to repo: ${newRoot}`);
    console.log(`[canopytag] canopy    = ${canopyPath}`);

    return {
      repoRoot: newRoot,
      repoName: path.basename(newRoot),
      isDemo: false,
    };
  });

  // GET /api/config/browse?path=... — list directories for folder browser
  app.get<{ Querystring: { path?: string } }>('/api/config/browse', async (req) => {
    const browsePath = req.query.path || (process.platform === 'win32' ? 'C:\\Users' : '/home');

    // Normalize to forward slashes so the frontend can safely concatenate paths
    const fwd = (p: string) => p.replace(/\\/g, '/');

    // Resolve to absolute
    const resolved = path.resolve(browsePath);

    if (!fs.existsSync(resolved)) {
      return { path: fwd(resolved), parent: fwd(path.dirname(resolved)), dirs: [], isGitRepo: false, hasCanopytag: false };
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { path: fwd(resolved), parent: fwd(path.dirname(resolved)), dirs: [], isGitRepo: false, hasCanopytag: false };
    }

    // List subdirectories (skip hidden dirs except .git)
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const isGitRepo = fs.existsSync(path.join(resolved, '.git'));
    const hasCanopytag =
      fs.existsSync(path.join(resolved, 'canopytag', 'canopy.json')) ||
      fs.existsSync(path.join(resolved, '.canopytag', 'canopy.json'));

    return {
      path: fwd(resolved),
      parent: fwd(path.dirname(resolved)),
      dirs,
      isGitRepo,
      hasCanopytag,
    };
  });
}
