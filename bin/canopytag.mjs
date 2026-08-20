#!/usr/bin/env node

/**
 * canopytag CLI dispatcher
 *
 * Routes `canopytag <command> [args]` to the appropriate handler.
 * Uses tsx to execute TypeScript source directly — no build step required.
 *
 * Usage:
 *   canopytag stats [options]
 *   canopytag ls [options]
 *   canopytag query [options]
 *   canopytag context <file> [options]
 *   canopytag compare <file...> [options]
 *   canopytag tags [options]
 *   canopytag todos [options]
 *   canopytag projects [project] [options]
 *   canopytag health [options]
 *   canopytag doctor [options]
 *   canopytag work <subcommand> [options]
 *   canopytag analytics [options]
 *   canopytag mcp [options]          # write project-local .mcp.json
 *   canopytag serve [options]        # start the backend JSON API (not the web UI)
 *   canopytag hook install           # install analytics hook
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const cliDir = join(__dirname, '..', 'src', 'cli');

const COMMANDS = {
  init:      join(cliDir, 'init.ts'),
  stats:     join(cliDir, 'stats.ts'),
  ls:        join(cliDir, 'ls.ts'),
  query:     join(cliDir, 'query.ts'),
  context:   join(cliDir, 'context.ts'),
  compare:   join(cliDir, 'compare.ts'),
  tags:      join(cliDir, 'tags.ts'),
  todos:     join(cliDir, 'todos.ts'),
  projects:  join(cliDir, 'projects.ts'),
  health:    join(cliDir, 'health.ts'),
  doctor:    join(cliDir, 'doctor.ts'),
  work:      join(cliDir, 'work.ts'),
  analytics: join(cliDir, 'analytics.ts'),
  mcp:       join(cliDir, 'mcp.ts'),
  coverage:  join(cliDir, 'coverage.ts'),
  hook:      join(cliDir, 'hook.ts'),
  serve:     join(__dirname, '..', 'src', 'backend', 'server.ts'),
};

const HELP = `canopytag — annotate, score, and navigate any codebase

Commands:
  init        Initialize a repo for annotation (canopytag/canopy.json)
  stats       Overview: file counts, authority distribution, open TODOs
  ls          List annotated files sorted by authority/scores/attention
  query       Authored catalogue search and relationship exploration
  context     Compact context block for files or features
  compare     Compare authority, quality, review status, and trust order
  tags        Browse tags and report tag hygiene
  todos       List open TODOs across the repo
  projects    List projects or inspect one multi-file work context
  health      Authority vs quality mismatch detection
  doctor      Deterministic metadata and maintenance checks
  work        Claim, query, renew, and release local active work
  coverage    Annotation coverage report with orphan detection
  analytics   Inspect agent activity heatmap
  mcp         Write or preview a project-local .mcp.json entry
  serve       Start the backend JSON API (does not serve the web UI)
  hook        Install/manage the analytics hook

Run \`canopytag <command> --help\` for command-specific options.
Global: --repo <path> or REPO_ROOT env to target a specific repo.

Opening the web UI (humans):
  From a CanopyTag checkout, run \`npm run dev\` and open http://localhost:5180
  This starts the Vite frontend and the backend API together.

  \`canopytag serve\` starts only the API on http://127.0.0.1:3100 — opening that
  port in a browser returns JSON, not the interface. Use it when you want the API
  alone, or are already running the frontend yourself.
`;

const command = process.argv[2];

if (!command || command === '--help' || command === '-h') {
  process.stdout.write(HELP);
  process.exit(0);
}

const target = COMMANDS[command];

if (!target) {
  process.stderr.write(`Unknown command: ${command}\n\nRun \`canopytag --help\` for available commands.\n`);
  process.exit(1);
}

// Forward remaining args to the target script via tsx
const forwardArgs = process.argv.slice(3);

// Use tsx's JS entrypoint directly through Node so the wrapper stays shell-free
// on Windows and Unix alike.
const tsxCli = require.resolve('tsx/cli');

const result = spawnSync(process.execPath, [tsxCli, target, ...forwardArgs], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
