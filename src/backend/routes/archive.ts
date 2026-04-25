import type { FastifyInstance } from 'fastify';
import { readArchive, writeArchive, writeCanopy } from '../lib/canopy';
import type { Todo, Comment } from '../../shared/types';

export async function archiveRoutes(app: FastifyInstance) {
  app.post<{ Body: { path: string; kind: 'todo' | 'comment'; itemId: string } }>(
    '/api/archive',
    async (req) => {
      const { canopy, canopyPath, archivePath } = app.serverState;
      const { path, kind, itemId } = req.body;
      const file = canopy.files[path];
      if (!file) return { ok: false, error: 'file not found' };

      const archive = readArchive(archivePath);
      let removed = false;

      if (kind === 'todo' && file.todos) {
        const idx = file.todos.findIndex((t: Todo) => t.id === itemId);
        if (idx >= 0) {
          const [item] = file.todos.splice(idx, 1);
          archive.items.push({ archivedAt: new Date().toISOString(), filePath: path, kind, item });
          removed = true;
        }
      } else if (kind === 'comment' && file.comments) {
        const idx = file.comments.findIndex((c: Comment) => c.id === itemId);
        if (idx >= 0) {
          const [item] = file.comments.splice(idx, 1);
          archive.items.push({ archivedAt: new Date().toISOString(), filePath: path, kind, item });
          removed = true;
        }
      }

      if (removed) {
        writeCanopy(canopyPath, canopy);
        writeArchive(archivePath, archive);
      }
      return { ok: removed };
    },
  );
}
