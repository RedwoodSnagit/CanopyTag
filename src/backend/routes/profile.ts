import type { FastifyInstance } from 'fastify';
import type { CanopyProfile } from '../../shared/types';
import { readOrCreateProfile, sanitizeHumanAuthor, writeProfile } from '../lib/profile';

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async () => {
    const profile = readOrCreateProfile(app.serverState.profilePath, app.serverState.repoRoot);
    app.serverState.profile = profile;
    return profile;
  });

  app.post<{ Body: Partial<CanopyProfile> & { name?: string } }>('/api/profile', async (request) => {
    const currentAuthor = request.body.currentAuthor
      ? sanitizeHumanAuthor(request.body.currentAuthor, app.serverState.repoRoot)
      : sanitizeHumanAuthor({ role: 'human', name: request.body.name }, app.serverState.repoRoot);

    const profile = writeProfile(app.serverState.profilePath, {
      version: 1,
      currentAuthor,
    });
    app.serverState.profile = profile;
    return profile;
  });
}
