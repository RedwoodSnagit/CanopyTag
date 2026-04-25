import type { FastifyInstance } from 'fastify';
import { readAnalytics } from '../lib/analytics.js';

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics', async () => {
    return readAnalytics(app.serverState.analyticsPath);
  });
}
