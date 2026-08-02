import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerActiveWorkTools } from '../tools/active-work.js';

type Handler = (params: any) => Promise<any>;

function mockServer(handlers: Map<string, Handler>): McpServer {
  return {
    tool(name: string, ...args: unknown[]) {
      handlers.set(name, args.at(-1) as Handler);
    },
  } as unknown as McpServer;
}

describe('active-work MCP registration', () => {
  it('exposes bounded check-in, query, renew, and check-out tools', () => {
    const names: string[] = [];
    const server = mockServer(new Map());
    (server.tool as any) = (name: string) => names.push(name);

    registerActiveWorkTools(server);

    expect(names).toEqual([
      'canopytag_active_work',
      'canopytag_claim_work',
      'canopytag_renew_work',
      'canopytag_release_work',
    ]);
  });

  it('runs claim, query, and release handlers against local state', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canopytag-work-mcp-'));
    const priorRepoRoot = process.env.REPO_ROOT;
    try {
      fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, 'canopytag'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(repoRoot, 'canopytag', 'canopy.json'), JSON.stringify({
        version: 1, repo_root: '', files: {}, features: {},
      }));
      process.env.REPO_ROOT = repoRoot;

      const handlers = new Map<string, Handler>();
      registerActiveWorkTools(mockServer(handlers));
      const claimResult = await handlers.get('canopytag_claim_work')!({
        paths: ['src/a.ts'], summary: 'MCP edit', agent_name: 'agent-a', agent_session: 'thread-1',
      });
      expect(claimResult.isError).toBeUndefined();
      const claimed = JSON.parse(claimResult.content[0].text);
      expect(claimed.claimed).toBe(true);

      const activeResult = await handlers.get('canopytag_active_work')!({ paths: ['src'] });
      expect(JSON.parse(activeResult.content[0].text).claims[0].id).toBe(claimed.claim.id);

      const releaseResult = await handlers.get('canopytag_release_work')!({
        claim_id: claimed.claim.id,
        note: 'Done',
        agent_name: 'agent-a',
        agent_session: 'thread-1',
      });
      expect(JSON.parse(releaseResult.content[0].text).released).toBe(true);
    } finally {
      if (priorRepoRoot === undefined) delete process.env.REPO_ROOT;
      else process.env.REPO_ROOT = priorRepoRoot;
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
