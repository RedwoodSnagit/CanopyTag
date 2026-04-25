import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { snakeToCamel } from '../../shared/case-transform';
import type { RepoIndexItem } from '../../shared/types';

export async function rescanRoutes(app: FastifyInstance) {
  app.post('/api/rescan', async (_request, reply) => {
    const { repoRoot } = app.serverState;

    // Reload repo_index.json if it exists (optional enrichment)
    const indexPath = path.join(repoRoot, 'docs', '_meta', 'repo_index.json');
    if (fs.existsSync(indexPath)) {
      const rawIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const items: RepoIndexItem[] = snakeToCamel(rawIndex.items);
      const repoIndex = new Map<string, RepoIndexItem>();
      for (const item of items) {
        repoIndex.set(item.path, item);
      }
      app.serverState.repoIndex = repoIndex;
    }

    return { success: true, output: 'Rescan complete.' };
  });
}
