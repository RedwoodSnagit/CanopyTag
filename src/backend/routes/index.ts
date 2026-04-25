import type { FastifyInstance } from 'fastify';
import { mergeFileRecord } from '../lib/merge';

export async function indexRoutes(app: FastifyInstance) {
  app.get('/api/index', async (_request, reply) => {
    const { repoIndex, canopy } = app.serverState;

    // Collect all unique paths from both sources
    const allPaths = new Set<string>();
    for (const path of repoIndex.keys()) {
      allPaths.add(path);
    }
    for (const path of Object.keys(canopy.files)) {
      allPaths.add(path);
    }

    const records = Array.from(allPaths).map((filePath) => {
      const repoItem = repoIndex.get(filePath);
      const canopyItem = canopy.files[filePath];
      return mergeFileRecord(filePath, repoItem, canopyItem);
    });

    return records;
  });
}
