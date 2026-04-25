import type { FastifyInstance } from 'fastify';

export async function tagsRoutes(app: FastifyInstance) {
  app.get('/api/tags', async (_request, reply) => {
    return app.serverState.tags;
  });
}
