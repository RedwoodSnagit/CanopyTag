import type { FastifyInstance } from 'fastify';
import { writeCanopy, nextTodoId, readArchive, writeArchive, runArchiveSweep } from '../lib/canopy';
import type { Todo, Priority, Author, TodoStatus, Difficulty } from '../../shared/types';

export async function todoRoutes(app: FastifyInstance) {
  // POST /api/todo — create new or update existing (if id provided)
  app.post<{
    Body: {
      path: string;
      id?: string;
      text?: string;
      priority?: Priority;
      status?: TodoStatus;
      tags?: string[];
      createdBy?: Author;
      difficulty?: Difficulty;
    };
  }>('/api/todo', async (request, reply) => {
    const { path: filePath, id, text, priority, status, tags, createdBy, difficulty } = request.body;
    if (!filePath) {
      return reply.status(400).send({ error: 'Missing required field: path' });
    }

    const { canopy, canopyPath } = app.serverState;

    // Initialize file entry if it doesn't exist
    if (!canopy.files[filePath]) {
      canopy.files[filePath] = {};
    }
    if (!canopy.files[filePath].todos) {
      canopy.files[filePath].todos = [];
    }

    // Update existing todo if id is provided
    if (id) {
      const existing = canopy.files[filePath].todos!.find(t => t.id === id);
      if (!existing) {
        return reply.status(404).send({ error: `Todo not found: ${id}` });
      }
      if (text !== undefined) existing.text = text;
      if (priority !== undefined) existing.priority = priority;
      if (status !== undefined) {
        existing.status = status;
        if (status === 'done') {
          existing.completedAt = new Date().toISOString();
        } else {
          delete existing.completedAt;
        }
      }
      if (tags !== undefined) existing.tags = tags;
      if (difficulty !== undefined) {
        if (difficulty === null) {
          delete existing.difficulty;
        } else {
          existing.difficulty = difficulty;
        }
      }
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

      return existing;
    }

    // Create new todo
    if (!text || priority === undefined) {
      return reply.status(400).send({ error: 'Missing required fields: text, priority' });
    }

    const todo: Todo = {
      id: nextTodoId(canopy),
      text,
      priority,
      status: 'open' as TodoStatus,
      tags: tags ?? [],
      createdAt: new Date().toISOString(),
      createdBy: createdBy ?? app.serverState.profile.currentAuthor,
      ...(difficulty != null && { difficulty }),
    };

    canopy.files[filePath].todos!.push(todo);
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

    return todo;
  });

  // DELETE /api/todo
  app.delete<{
    Body: { path: string; todoId: string };
  }>('/api/todo', async (request, reply) => {
    const { path: filePath, todoId } = request.body;
    if (!filePath || !todoId) {
      return reply.status(400).send({ error: 'Missing required fields: path, todoId' });
    }

    const { canopy, canopyPath } = app.serverState;

    const fileEntry = canopy.files[filePath];
    if (!fileEntry?.todos) {
      return reply.status(404).send({ error: `No todos found for path: ${filePath}` });
    }

    const idx = fileEntry.todos.findIndex((t) => t.id === todoId);
    if (idx === -1) {
      return reply.status(404).send({ error: `Todo not found: ${todoId}` });
    }

    fileEntry.todos.splice(idx, 1);
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

    return { success: true };
  });
}
