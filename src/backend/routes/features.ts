import type { FastifyInstance } from 'fastify';
import { writeCanopy } from '../lib/canopy';
import type {
  Author,
  Feature,
  FeaturePromotionStatus,
  FileStatus,
} from '../../shared/types';

interface FeatureUpsertBody {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  status?: FileStatus;
  canonicalFile?: string;
  owners?: Author[];
  openQuestions?: string[];
  promotionStatus?: FeaturePromotionStatus;
}

export async function featuresRoutes(app: FastifyInstance) {
  // GET /api/features
  app.get('/api/features', async (_request, reply) => {
    const { canopy } = app.serverState;
    return canopy.features;
  });

  // POST /api/features
  app.post<{ Body: FeatureUpsertBody }>('/api/features', async (request, reply) => {
    const {
      id,
      name,
      description,
      tags,
      status,
      canonicalFile,
      owners,
      openQuestions,
      promotionStatus,
    } = request.body;
    if (!id || !name) {
      return reply.status(400).send({ error: 'Missing required fields: id, name' });
    }

    const { canopy, canopyPath } = app.serverState;
    const existing = canopy.features[id];

    const feature: Feature = { name };
    if (description !== undefined) feature.description = description;
    if (tags !== undefined) feature.tags = tags;
    if (status !== undefined) feature.status = status;

    // POST retains its existing replacement semantics for the basic feature card,
    // while richer routing/governance fields survive older, narrower clients.
    feature.canonicalFile = canonicalFile ?? existing?.canonicalFile;
    feature.owners = owners ?? existing?.owners;
    feature.openQuestions = openQuestions ?? existing?.openQuestions;
    feature.promotionStatus = promotionStatus ?? existing?.promotionStatus;

    canopy.features[id] = feature;
    writeCanopy(canopyPath, canopy);

    return canopy.features[id];
  });

  // DELETE /api/features
  app.delete<{
    Body: { id: string };
  }>('/api/features', async (request, reply) => {
    const { id } = request.body;
    if (!id) {
      return reply.status(400).send({ error: 'Missing required field: id' });
    }

    const { canopy, canopyPath } = app.serverState;

    if (!canopy.features[id]) {
      return reply.status(404).send({ error: `Feature not found: ${id}` });
    }

    delete canopy.features[id];
    writeCanopy(canopyPath, canopy);

    return { success: true };
  });
}
