import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCanopytagMcpServer,
  buildMergedMcpConfig,
  getMcpConfigPath,
  readMcpConfig,
  writeMcpConfig,
} from '../mcp.js';

describe('canopytag mcp helpers', () => {
  it('builds a canopytag MCP server entry for the target repo', () => {
    const repoRoot = path.join(os.tmpdir(), 'ct-mcp-repo');
    const server = buildCanopytagMcpServer(repoRoot);

    expect(server.command).toBe(process.execPath);
    expect(server.args[0]).toContain(path.join('tsx', 'dist', 'cli.mjs'));
    expect(server.args[1].replace(/\\/g, '/')).toMatch(/src\/mcp\/server\.ts$/);
    expect(server.env.REPO_ROOT).toBe(path.resolve(repoRoot));
  });

  it('merges canopytag into an existing MCP config without clobbering other servers', () => {
    const repoRoot = path.join(os.tmpdir(), 'ct-mcp-merge');
    const merged = buildMergedMcpConfig({
      note: 'keep me',
      mcpServers: {
        other: { command: 'uvx', args: ['tool'] },
      },
    }, repoRoot);

    expect(merged.note).toBe('keep me');
    expect(merged.mcpServers?.other).toEqual({ command: 'uvx', args: ['tool'] });
    expect(merged.mcpServers?.canopytag).toBeDefined();
  });

  it('writes .mcp.json and preserves existing keys', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mcp-write-'));
    try {
      const configPath = getMcpConfigPath(repoRoot);
      fs.writeFileSync(configPath, JSON.stringify({
        note: 'keep me',
        mcpServers: {
          other: { command: 'uvx', args: ['tool'] },
        },
      }, null, 2));

      const result = writeMcpConfig(repoRoot);
      const written = readMcpConfig(configPath);

      expect(result.status).toBe('updated');
      expect(written.note).toBe('keep me');
      expect(written.mcpServers?.other).toEqual({ command: 'uvx', args: ['tool'] });
      expect(written.mcpServers?.canopytag).toBeDefined();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('reads existing MCP configs with a UTF-8 BOM', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mcp-bom-'));
    try {
      const configPath = getMcpConfigPath(repoRoot);
      fs.writeFileSync(configPath, '\uFEFF' + JSON.stringify({
        note: 'keep me',
      }, null, 2));

      expect(readMcpConfig(configPath).note).toBe('keep me');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite a different canopytag entry without --force', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mcp-conflict-'));
    try {
      const configPath = getMcpConfigPath(repoRoot);
      fs.writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          canopytag: {
            command: 'node',
            args: ['custom-entry.js'],
            env: { REPO_ROOT: repoRoot },
          },
        },
      }, null, 2));

      expect(() => writeMcpConfig(repoRoot)).toThrow(/already exists/i);
      expect(writeMcpConfig(repoRoot, true).status).toBe('updated');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
