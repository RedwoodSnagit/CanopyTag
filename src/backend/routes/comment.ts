import type { FastifyInstance } from 'fastify';
import { writeCanopy, nextCommentId, readArchive, writeArchive, runArchiveSweep } from '../lib/canopy';
import type { Comment, Author, CommentType, Confidence } from '../../shared/types';

export async function commentRoutes(app: FastifyInstance) {
  // POST /api/comment
  app.post<{
    Body: { path: string; text: string; author?: Author; type?: CommentType; confidence?: Confidence };
  }>('/api/comment', async (request, reply) => {
    const { body } = request;
    if (!body.path || !body.text) {
      return reply.status(400).send({ error: 'Missing required fields: path, text' });
    }

    const { canopy, canopyPath } = app.serverState;

    if (!canopy.files[body.path]) {
      canopy.files[body.path] = {};
    }
    if (!canopy.files[body.path].comments) {
      canopy.files[body.path].comments = [];
    }

    const comment: Comment = {
      id: nextCommentId(canopy),
      text: body.text.trim(),
      author: body.author ?? app.serverState.profile.currentAuthor,
      createdAt: new Date().toISOString(),
      ...(body.type && { type: body.type }),
      ...(body.confidence != null && { confidence: body.confidence }),
    };

    canopy.files[body.path].comments!.push(comment);
    writeCanopy(canopyPath, canopy);

    {
      const { settings, archivePath } = app.serverState;
      const archive = readArchive(archivePath);
      const { swept: sweepCount } = runArchiveSweep(canopy, archive, settings.archiveRetention);
      if (sweepCount > 0) {
        writeCanopy(canopyPath, canopy);
        writeArchive(archivePath, archive);
      }
    }

    return comment;
  });

  // DELETE /api/comment
  app.delete<{ Body: { path: string; commentId: string } }>('/api/comment', async (req) => {
    const { canopy, canopyPath } = app.serverState;
    const { path: filePath, commentId } = req.body;
    const file = canopy.files[filePath];
    if (!file?.comments) return { ok: false };
    const idx = file.comments.findIndex(c => c.id === commentId);
    if (idx < 0) return { ok: false };
    file.comments.splice(idx, 1);
    writeCanopy(canopyPath, canopy);

    {
      const { settings, archivePath } = app.serverState;
      const archive = readArchive(archivePath);
      const { swept: sweepCount } = runArchiveSweep(canopy, archive, settings.archiveRetention);
      if (sweepCount > 0) {
        writeCanopy(canopyPath, canopy);
        writeArchive(archivePath, archive);
      }
    }

    return { ok: true };
  });
}
