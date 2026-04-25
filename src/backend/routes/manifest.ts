import type { FastifyInstance } from 'fastify';
import {
  readAgentManifest,
  resolveAgentManifestPath,
  reviewAgentManifestEntry,
} from '../lib/agent-manifest.js';
import type { AgentReviewAction } from '../../shared/types.js';

export async function manifestRoutes(app: FastifyInstance) {
  async function listEntries() {
    const manifestPath = resolveAgentManifestPath(app.serverState.repoRoot);
    return readAgentManifest(manifestPath).entries;
  }

  app.get('/api/manifest', listEntries);
  app.get('/api/activity', listEntries);

  async function reviewEntry(action: AgentReviewAction, id: string, note?: string) {
    const manifestPath = resolveAgentManifestPath(app.serverState.repoRoot);
    return reviewAgentManifestEntry(app.serverState.canopyPath, manifestPath, {
      id,
      action,
      note,
      reviewer: app.serverState.profile.currentAuthor,
    });
  }

  app.post<{ Body: { id: string; action: AgentReviewAction; note?: string } }>('/api/manifest/review', async (request, reply) => {
    const { id, action, note } = request.body;
    if (!id || !action) {
      return reply.status(400).send({ error: 'Missing required fields: id, action' });
    }
    return reviewEntry(action, id, note);
  });

  app.post<{ Body: { id: string; action: AgentReviewAction; note?: string } }>('/api/activity/review', async (request, reply) => {
    const { id, action, note } = request.body;
    if (!id || !action) {
      return reply.status(400).send({ error: 'Missing required fields: id, action' });
    }
    return reviewEntry(action, id, note);
  });
}
