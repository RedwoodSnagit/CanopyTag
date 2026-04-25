import type { FastifyInstance } from 'fastify';
import { walkTree } from '../lib/tree-walker';

export async function treeRoutes(app: FastifyInstance) {
  app.get('/api/tree', async (_request, reply) => {
    const { repoRoot } = app.serverState;
    const tree = walkTree(repoRoot);
    return tree;
  });
}
