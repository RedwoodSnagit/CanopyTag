#!/usr/bin/env node
/**
 * canopytag mcp - scaffold per-project MCP config
 *
 * Writes or previews a .mcp.json file for the target repo so MCP-capable
 * clients can launch the local CanopyTag server consistently.
 *
 * Usage:
 *   canopytag mcp
 *   canopytag mcp --repo /path/to/repo
 *   canopytag mcp --print
 *   canopytag mcp --force
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { parseJsonFile } from '../backend/lib/canopy.js';
import { CORE_OPTIONS, resolveRepoRoot } from './shared.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig | Record<string, unknown>>;
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getCanopytagRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function getMcpConfigPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), '.mcp.json');
}

export function buildCanopytagMcpServer(repoRoot: string): McpServerConfig {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const canopytagRoot = getCanopytagRoot();
  return {
    command: process.execPath,
    args: [
      require.resolve('tsx/cli'),
      path.join(canopytagRoot, 'src', 'mcp', 'server.ts'),
    ],
    env: {
      REPO_ROOT: resolvedRepoRoot,
    },
  };
}

export function readMcpConfig(configPath: string): McpConfig {
  if (!fs.existsSync(configPath)) return {};
  let parsed: unknown;
  try {
    parsed = parseJsonFile(configPath);
  } catch {
    throw new Error(`${configPath} exists but is not valid JSON.`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  if (parsed.mcpServers != null && !isObject(parsed.mcpServers)) {
    throw new Error(`${configPath} has an invalid mcpServers section.`);
  }
  return parsed;
}

export function buildMergedMcpConfig(existingConfig: McpConfig, repoRoot: string): McpConfig {
  const existingServers = isObject(existingConfig.mcpServers) ? existingConfig.mcpServers : {};
  return {
    ...existingConfig,
    mcpServers: {
      ...existingServers,
      canopytag: buildCanopytagMcpServer(repoRoot),
    },
  };
}

export function writeMcpConfig(repoRoot: string, force = false): {
  configPath: string;
  status: 'created' | 'updated' | 'unchanged';
} {
  const configPath = getMcpConfigPath(repoRoot);
  const existingConfig = readMcpConfig(configPath);
  const existingServer = isObject(existingConfig.mcpServers)
    ? existingConfig.mcpServers.canopytag
    : undefined;
  const nextServer = buildCanopytagMcpServer(repoRoot);

  if (existingServer && JSON.stringify(existingServer) !== JSON.stringify(nextServer) && !force) {
    throw new Error(
      `A canopytag MCP entry already exists in ${configPath}. Re-run with --force to replace it or --print to preview the merged config.`,
    );
  }

  const nextConfig = buildMergedMcpConfig(existingConfig, repoRoot);
  const nextText = JSON.stringify(nextConfig, null, 2) + '\n';
  const currentText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
  if (currentText === nextText) {
    return { configPath, status: 'unchanged' };
  }

  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, nextText, 'utf-8');
  fs.renameSync(tmpPath, configPath);

  return {
    configPath,
    status: currentText == null ? 'created' : 'updated',
  };
}

function printHelp(): void {
  process.stdout.write(`canopytag mcp - scaffold per-project MCP config

Usage:
  canopytag mcp [--repo <path>] [--print] [--force]

Options:
  --repo, -r  Target repo for the generated .mcp.json (default: current directory)
  --print     Print the merged .mcp.json instead of writing it
  --force     Replace an existing canopytag MCP entry if one already exists
  --help, -h  Show this help

Writes a preferred project-local .mcp.json entry for CanopyTag.
After changing MCP config, restart the client/session and verify with:
  claude mcp list
`);
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').match(/cli\/mcp\.[tj]s$/);
if (isDirectRun) {
  const { values } = parseArgs({
    options: {
      ...CORE_OPTIONS,
      print: { type: 'boolean' },
      force: { type: 'boolean' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const repoRoot = path.resolve(resolveRepoRoot(values.repo as string | undefined));
  const configPath = getMcpConfigPath(repoRoot);

  try {
    const existingConfig = readMcpConfig(configPath);
    if (values.print) {
      const merged = buildMergedMcpConfig(existingConfig, repoRoot);
      process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
      process.exit(0);
    }

    const { status } = writeMcpConfig(repoRoot, values.force === true);
    if (status === 'unchanged') {
      process.stdout.write(`Already configured: ${configPath}\n`);
    } else if (status === 'created') {
      process.stdout.write(`Wrote ${configPath}\n`);
    } else {
      process.stdout.write(`Updated ${configPath}\n`);
    }
    process.stdout.write(`\nNext steps:\n`);
    process.stdout.write(`  1. Restart your MCP client/session so it reloads .mcp.json\n`);
    process.stdout.write(`  2. Run claude mcp list to confirm canopytag is registered\n`);
    process.stdout.write(`  3. Optional: run canopytag hook install for Claude analytics hooks\n`);
    process.stdout.write(`\nNote: .mcp.json contains local absolute paths. Keep it uncommitted or review it before sharing a public repo.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}
