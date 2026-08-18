import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { camelToSnake } from '../../shared/case-transform.js';
import {
  claimWork,
  listWorkClaims,
  parseTtl,
  readActiveWork,
  releaseWorkClaim,
  renewWorkClaim,
  resolveActiveWorkPath,
  resolveTodoLink,
} from '../../backend/lib/active-work.js';
import { readCanopy } from '../../backend/lib/canopy.js';
import { ensureLocalFileIgnored } from '../../backend/lib/profile.js';
import { resolveCanopyPath, resolveRepoRoot } from '../../cli/shared.js';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function identity(params: { agent_name?: string; agent_session?: string }): {
  owner: string;
  session?: string;
} {
  const owner = clean(params.agent_name)
    ?? clean(process.env.CANOPYTAG_AGENT_NAME)
    ?? clean(process.env.MCP_CLIENT_NAME);
  if (!owner) {
    throw new Error('Work mutations require agent_name or CANOPYTAG_AGENT_NAME.');
  }
  const session = clean(params.agent_session) ?? clean(process.env.CANOPYTAG_AGENT_SESSION);
  return { owner, ...(session ? { session } : {}) };
}

function json(value: unknown): string {
  return JSON.stringify(camelToSnake(value), null, 2);
}

const attributionFields = {
  // Left optional here, unlike the authored-metadata writes: claims are
  // ephemeral local coordination, not part of the durable record, and the
  // renew/release flow matches on session rather than name.
  agent_name: z.string().optional()
    .describe('Your model identity, e.g. "Claude Opus 5". Falls back to CANOPYTAG_AGENT_NAME or MCP_CLIENT_NAME.'),
  agent_session: z.string().optional()
    .describe('Session/thread identifier. A claimed session must match on renew/release.'),
};

export function registerActiveWorkTools(server: McpServer): void {
  server.tool(
    'canopytag_active_work',
    'Check same-checkout, local expiring work claims before editing. Filter by paths or owner; this is advisory coordination, not persistent WIP or cross-worktree state. Persistent unfinished state belongs in TODO/status/lifecycle metadata.',
    {
      paths: z.array(z.string()).optional().describe('Repository-relative files or directories to check'),
      owner: z.string().optional().describe('Only claims owned by this agent/worker'),
      include_history: z.boolean().optional().describe('Include released and expired claims'),
    },
    async (params) => {
      try {
        const activeWorkPath = resolveActiveWorkPath(resolveRepoRoot());
        const claims = listWorkClaims(readActiveWork(activeWorkPath), {
          paths: params.paths,
          owner: params.owner,
          includeHistory: params.include_history,
        });
        return { content: [{ type: 'text' as const, text: json({ claims }) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: error.message }], isError: true };
      }
    },
  );

  server.tool(
    'canopytag_claim_work',
    'Create a same-checkout, local expiring claim before editing files. Claims can link to a CanopyTag TODO but never modify or complete it.',
    {
      paths: z.array(z.string()).min(1).describe('Repository-relative files or directories being edited; end a planned directory with /'),
      summary: z.string().min(1).describe('Short purpose of this work'),
      ttl: z.string().optional().describe('Lease duration such as 30m, 4h, or 2d; default 4h, maximum 7d'),
      shared: z.boolean().optional().describe('Allow overlapping shared claims; exclusive is the default'),
      todo_id: z.string().optional().describe('Optional CanopyTag TODO ID'),
      todo_file: z.string().optional().describe('File containing the TODO when its ID is not globally unique'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const activeWorkPath = resolveActiveWorkPath(repoRoot);
        const actor = identity(params);
        if (params.todo_file && !params.todo_id) throw new Error('todo_file requires todo_id.');
        ensureLocalFileIgnored(repoRoot, activeWorkPath, '# CanopyTag local active work', '*');
        const todo = params.todo_id
          ? resolveTodoLink(readCanopy(resolveCanopyPath(repoRoot)), params.todo_id, params.todo_file)
          : undefined;
        const result = claimWork(repoRoot, activeWorkPath, {
          paths: params.paths,
          owner: actor.owner,
          session: actor.session,
          summary: params.summary,
          ttlSeconds: parseTtl(params.ttl),
          exclusive: params.shared !== true,
          todo,
        });
        if (!result.claim) {
          return {
            content: [{ type: 'text' as const, text: json({ claimed: false, conflicts: result.conflicts }) }],
            isError: true,
          };
        }
        return { content: [{ type: 'text' as const, text: json({ claimed: true, claim: result.claim }) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: error.message }], isError: true };
      }
    },
  );

  server.tool(
    'canopytag_renew_work',
    'Renew an active work claim before its lease expires.',
    {
      claim_id: z.string().min(1),
      ttl: z.string().optional().describe('New lease duration such as 30m, 4h, or 2d'),
      force: z.boolean().optional().describe('Override owner/session after reviewing the stale or abandoned claim'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const actor = identity(params);
        const repoRoot = resolveRepoRoot();
        const activeWorkPath = resolveActiveWorkPath(repoRoot);
        ensureLocalFileIgnored(repoRoot, activeWorkPath, '# CanopyTag local active work', '*');
        const claim = renewWorkClaim(activeWorkPath, params.claim_id, {
          ...actor,
          ttlSeconds: parseTtl(params.ttl),
          force: params.force,
        });
        return { content: [{ type: 'text' as const, text: json({ renewed: true, claim }) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: error.message }], isError: true };
      }
    },
  );

  server.tool(
    'canopytag_release_work',
    'Release a local work claim when editing is finished or handed off. This does not complete linked TODOs.',
    {
      claim_id: z.string().min(1),
      note: z.string().optional().describe('Short completion or handoff note'),
      force: z.boolean().optional().describe('Override owner/session after reviewing the stale or abandoned claim'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const actor = identity(params);
        const repoRoot = resolveRepoRoot();
        const activeWorkPath = resolveActiveWorkPath(repoRoot);
        ensureLocalFileIgnored(repoRoot, activeWorkPath, '# CanopyTag local active work', '*');
        const claim = releaseWorkClaim(activeWorkPath, params.claim_id, {
          ...actor,
          note: params.note,
          force: params.force,
        });
        return { content: [{ type: 'text' as const, text: json({ released: true, claim }) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: error.message }], isError: true };
      }
    },
  );
}
