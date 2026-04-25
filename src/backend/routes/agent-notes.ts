import type { FastifyInstance } from 'fastify';
import { writeCanopy } from '../lib/canopy';
import type { AgentNote } from '../../shared/types';

export async function agentNotesRoutes(app: FastifyInstance) {
  // GET /api/agent-notes — return all agent notes
  app.get('/api/agent-notes', async () => {
    const { canopy } = app.serverState;
    return canopy.agentNotes ?? [];
  });

  // POST /api/agent-notes — agent posts a handoff note
  app.post<{
    Body: { text: string; agent: string };
  }>('/api/agent-notes', async (request, reply) => {
    const { text, agent } = request.body;
    if (!text || !agent) {
      return reply.status(400).send({ error: 'Missing required fields: text, agent' });
    }

    const { canopy, canopyPath } = app.serverState;

    if (!canopy.agentNotes) {
      canopy.agentNotes = [];
    }

    const note: AgentNote = {
      text,
      agent,
      createdAt: new Date().toISOString(),
    };

    canopy.agentNotes.push(note);
    writeCanopy(canopyPath, canopy);

    return note;
  });

  // POST /api/agent-notes/acknowledge — human acknowledges a note
  app.post<{
    Body: { index: number };
  }>('/api/agent-notes/acknowledge', async (request, reply) => {
    const { index } = request.body;
    const { canopy, canopyPath } = app.serverState;

    if (!canopy.agentNotes || index < 0 || index >= canopy.agentNotes.length) {
      return reply.status(404).send({ error: `Agent note not found at index ${index}` });
    }

    canopy.agentNotes[index].acknowledged = true;
    writeCanopy(canopyPath, canopy);

    return { success: true };
  });
}
