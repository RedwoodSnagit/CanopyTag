import type { FastifyInstance } from 'fastify';
import { writeCanopy } from '../lib/canopy';

export async function directoryRoutes(app: FastifyInstance) {
  // GET /api/directory?path=...
  app.get<{
    Querystring: { path: string };
  }>('/api/directory', async (request, reply) => {
    const dirPath = request.query.path;
    if (!dirPath) {
      return reply.status(400).send({ error: 'Missing required query param: path' });
    }

    const { canopy } = app.serverState;
    const entry = canopy.directories?.[dirPath];

    // Count files and open TODOs under this directory
    let fileCount = 0;
    let openTodoCount = 0;
    for (const [filePath, fileMeta] of Object.entries(canopy.files)) {
      if (filePath.startsWith(dirPath + '/')) {
        fileCount++;
        openTodoCount += (fileMeta.todos ?? []).filter(t => t.status === 'open' || t.status === 'in_progress').length;
      }
    }

    return {
      path: dirPath,
      summary: entry?.summary,
      fileCount,
      openTodoCount,
    };
  });

  // POST /api/directory/meta
  app.post<{
    Body: { path: string; summary?: string };
  }>('/api/directory/meta', async (request, reply) => {
    const { path: dirPath, summary } = request.body;
    if (!dirPath) {
      return reply.status(400).send({ error: 'Missing required field: path' });
    }

    const { canopy, canopyPath } = app.serverState;

    if (!canopy.directories) {
      canopy.directories = {};
    }
    if (!canopy.directories[dirPath]) {
      canopy.directories[dirPath] = {};
    }

    if (summary !== undefined) {
      canopy.directories[dirPath].summary = summary || undefined;
    }

    writeCanopy(canopyPath, canopy);

    return canopy.directories[dirPath];
  });
}
