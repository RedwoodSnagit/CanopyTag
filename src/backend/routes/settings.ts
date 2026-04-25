import type { FastifyInstance } from 'fastify';
import { readSettings, writeSettings } from '../lib/canopy';
import type { CanopySettings } from '../../shared/types';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    return app.serverState.settings;
  });

  app.post<{ Body: Partial<CanopySettings> }>('/api/settings', async (req) => {
    const { settingsPath } = app.serverState;
    const current = app.serverState.settings;
    const updated = { ...current, ...req.body };
    writeSettings(settingsPath, updated);
    app.serverState.settings = readSettings(settingsPath);
    return { ok: true };
  });
}
