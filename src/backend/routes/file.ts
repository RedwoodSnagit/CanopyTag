import type { FastifyInstance } from 'fastify';
import { mergeFileRecord } from '../lib/merge';
import { writeCanopy } from '../lib/canopy';
import { getLastModified } from '../lib/git-info';
import { snakeToCamel } from '../../shared/case-transform';
import type { FileCanopy } from '../../shared/types';

export async function fileRoutes(app: FastifyInstance) {
  // GET /api/file?path=...
  app.get<{ Querystring: { path: string } }>('/api/file', async (request, reply) => {
    const { path: filePath } = request.query;
    if (!filePath) {
      return reply.status(400).send({ error: 'Missing path query parameter' });
    }

    const { repoIndex, canopy } = app.serverState;
    const repoItem = repoIndex.get(filePath);
    const canopyItem = canopy.files[filePath];

    // Return a merged record for any file — even if not in repo_index or canopy.
    // This allows clicking any file in the tree to show its (empty) detail panel.
    const merged = mergeFileRecord(filePath, repoItem, canopyItem);
    merged.lastModified = getLastModified(app.serverState.repoRoot, filePath);
    return merged;
  });

  // POST /api/file/meta
  app.post<{
    Body: {
      path: string;
      title?: string;
      summary?: string;
      validity?: number;
      clarity?: number;
      completeness?: number;
      stability?: number;
      scoresReviewed?: boolean;
      tags?: string[];
      featureId?: string;
      authorityLevel?: string;
      status?: string;
      ioMetadata?: { inputs?: string[]; outputs?: string[] };
      relatedFiles?: import('../../shared/types').RelatedFileEntry[];
    };
  }>('/api/file/meta', async (request, reply) => {
    const { path: filePath, ...meta } = request.body;
    if (!filePath) {
      return reply.status(400).send({ error: 'Missing path in body' });
    }

    const { canopy, canopyPath, repoIndex } = app.serverState;

    // Initialize file entry if it doesn't exist
    if (!canopy.files[filePath]) {
      canopy.files[filePath] = {};
    }

    const entry = canopy.files[filePath];

    // Upsert only the provided fields (NOT todos or comments)
    // null means "clear this field", undefined means "not provided"
    if (meta.title !== undefined) entry.title = meta.title ?? undefined;
    if (meta.summary !== undefined) entry.summary = meta.summary ?? undefined;
    if (meta.validity !== undefined) entry.validity = meta.validity ?? undefined;
    if (meta.clarity !== undefined) entry.clarity = meta.clarity ?? undefined;
    if (meta.completeness !== undefined) entry.completeness = meta.completeness ?? undefined;
    if (meta.stability !== undefined) entry.stability = meta.stability ?? undefined;
    if (meta.scoresReviewed !== undefined) entry.scoresReviewed = meta.scoresReviewed ?? undefined;
    if (meta.tags !== undefined) entry.tags = meta.tags ?? undefined;
    if (meta.featureId !== undefined) entry.featureId = meta.featureId ?? undefined;
    if (meta.authorityLevel !== undefined) entry.authorityLevel = (meta.authorityLevel ?? undefined) as FileCanopy['authorityLevel'];
    if (meta.status !== undefined) entry.status = (meta.status ?? undefined) as FileCanopy['status'];
    if (meta.ioMetadata !== undefined) entry.ioMetadata = meta.ioMetadata ?? undefined;
    if (meta.relatedFiles !== undefined) entry.relatedFiles = meta.relatedFiles ?? undefined;

    // Auto-stamp lastReviewed on any human edit
    entry.lastReviewed = new Date().toISOString().slice(0, 10);
    entry.lastReviewedBy = app.serverState.profile.currentAuthor;

    writeCanopy(canopyPath, canopy);

    const repoItem = repoIndex.get(filePath);
    const merged = mergeFileRecord(filePath, repoItem, canopy.files[filePath]);
    return merged;
  });
}
