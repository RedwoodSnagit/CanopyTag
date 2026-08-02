#!/usr/bin/env node
/** Local, expiring work claims for agent coordination. */

import { parseArgs } from 'node:util';
import { camelToSnake } from '../shared/case-transform.js';
import type { WorkClaim } from '../shared/types.js';
import {
  claimWork,
  listWorkClaims,
  parseTtl,
  readActiveWork,
  releaseWorkClaim,
  renewWorkClaim,
  resolveActiveWorkPath,
  resolveTodoLink,
  type WorkClaimView,
} from '../backend/lib/active-work.js';
import { readCanopy } from '../backend/lib/canopy.js';
import { ensureLocalFileIgnored } from '../backend/lib/profile.js';
import { resolveCanopyPath, resolveRepoRoot } from './shared.js';

const HELP = `canopytag work — local, expiring agent work claims

Usage:
  canopytag work list [--path <path>...] [--owner <name>] [--all] [--json]
  canopytag work check <path>... [--json]
  canopytag work claim --path <path>... --summary <text> [options]
  canopytag work renew <claim-id> [--ttl 4h] [options]
  canopytag work release <claim-id> [--note <text>] [options]

Options:
  --repo, -r <path>       Target repository
  --owner <name>          Agent/worker name; required for mutations unless set in CANOPYTAG_AGENT_NAME
  --session <id>          Session/thread identifier
  --ttl <duration>        30m, 4h, or 2d; default 4h, maximum 7d
  --path, -p <path>       Repository-relative file/directory; repeatable
  --summary, -s <text>    Short purpose of the work
  --shared                Advisory shared claim; exclusive is the default
  --todo-id <id>          Link a unique CanopyTag TODO
  --todo-file <path>      Disambiguate the linked TODO
  --force                 Release/renew another actor's claim after review
  --all                   Include released and expired history
  --json                   Machine-readable JSON output

Claims are stored in git-ignored canopytag/.active_work.json. They do not edit
canopy.json, complete TODOs, enforce Git writes, or replace a task tracker.
They coordinate processes in the same checkout, not separate Git worktrees.
End a planned/nonexistent directory path with a slash. Local history is retained
for seven days (up to 500 records).
Persistent unfinished state belongs in CanopyTag TODO, status, or lifecycle metadata.
`;

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function actor(values: Record<string, unknown>): { owner: string; session?: string } {
  const owner = clean(values.owner)
    ?? clean(process.env.CANOPYTAG_AGENT_NAME)
    ?? clean(process.env.MCP_CLIENT_NAME);
  if (!owner) {
    throw new Error('Mutating work commands require --owner or CANOPYTAG_AGENT_NAME.');
  }
  const session = clean(values.session) ?? clean(process.env.CANOPYTAG_AGENT_SESSION);
  return { owner, ...(session ? { session } : {}) };
}

export function renderWorkClaims(claims: WorkClaimView[]): string {
  if (claims.length === 0) return 'No matching active-work claims.';
  const lines = [`${claims.length} work claim${claims.length === 1 ? '' : 's'}`];
  for (const claim of claims) {
    const scope = claim.exclusive ? 'exclusive' : 'shared';
    const session = claim.session ? ` session=${claim.session}` : '';
    lines.push(`\n${claim.id}  ${claim.derivedState}  ${scope}  owner=${claim.owner}${session}`);
    lines.push(`  paths: ${claim.paths.map(item => item.kind === 'directory' ? `${item.path}/` : item.path).join(', ')}`);
    lines.push(`  purpose: ${claim.summary}`);
    lines.push(`  updated: ${claim.updatedAt}  expires: ${claim.expiresAt}`);
    if (claim.branch) lines.push(`  branch: ${claim.branch}`);
    if (claim.todo) lines.push(`  TODO: ${claim.todo.file}#${claim.todo.id}`);
    if (claim.releaseNote) lines.push(`  release: ${claim.releaseNote}`);
  }
  return lines.join('\n');
}

function output(value: WorkClaim | WorkClaimView[] | { conflicts: WorkClaim[] }, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(camelToSnake(value), null, 2) + '\n');
    return;
  }
  if (Array.isArray(value)) {
    process.stdout.write(renderWorkClaims(value) + '\n');
    return;
  }
  if ('conflicts' in value) {
    const views = value.conflicts.map(claim => ({ ...claim, derivedState: 'active' as const }));
    process.stderr.write(`Claim conflicts with existing active work:\n${renderWorkClaims(views)}\n`);
    return;
  }
  const view: WorkClaimView = {
    ...value,
    derivedState: value.state === 'released' ? 'released' : 'active',
  };
  process.stdout.write(renderWorkClaims([view]) + '\n');
}

function parseOptions(args: string[], allowPositionals = false) {
  return parseArgs({
    args,
    options: {
      repo: { type: 'string', short: 'r' },
      path: { type: 'string', short: 'p', multiple: true },
      owner: { type: 'string' },
      session: { type: 'string' },
      ttl: { type: 'string' },
      summary: { type: 'string', short: 's' },
      shared: { type: 'boolean' },
      'todo-id': { type: 'string' },
      'todo-file': { type: 'string' },
      note: { type: 'string' },
      force: { type: 'boolean' },
      all: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals,
    strict: true,
  });
}

export function runWorkCli(args: string[]): number {
  const subcommand = args[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  try {
    const parsed = parseOptions(args.slice(1), true);
    const values = parsed.values as Record<string, unknown>;
    if (values.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const repoRoot = resolveRepoRoot(clean(values.repo));
    const activeWorkPath = resolveActiveWorkPath(repoRoot);
    const json = values.json === true;
    const paths = [
      ...((values.path as string[] | undefined) ?? []),
      ...(subcommand === 'check' ? parsed.positionals : []),
    ];

    if (subcommand === 'list' || subcommand === 'check' || subcommand === 'status') {
      const claims = listWorkClaims(readActiveWork(activeWorkPath), {
        paths,
        owner: clean(values.owner),
        includeHistory: values.all === true,
      });
      output(claims, json);
      return 0;
    }

    const identity = actor(values);
    ensureLocalFileIgnored(repoRoot, activeWorkPath, '# CanopyTag local active work', '*');

    if (subcommand === 'claim' || subcommand === 'start') {
      if (paths.length === 0) throw new Error('claim requires at least one --path.');
      const summary = clean(values.summary);
      if (!summary) throw new Error('claim requires --summary.');
      const todoId = clean(values['todo-id']);
      if (clean(values['todo-file']) && !todoId) throw new Error('--todo-file requires --todo-id.');
      const todo = todoId
        ? resolveTodoLink(readCanopy(resolveCanopyPath(repoRoot)), todoId, clean(values['todo-file']))
        : undefined;
      const result = claimWork(repoRoot, activeWorkPath, {
        paths,
        owner: identity.owner,
        session: identity.session,
        summary,
        ttlSeconds: parseTtl(clean(values.ttl)),
        exclusive: values.shared !== true,
        todo,
      });
      if (!result.claim) {
        output({ conflicts: result.conflicts }, json);
        return 2;
      }
      output(result.claim, json);
      return 0;
    }

    const id = parsed.positionals[0];
    if (!id) throw new Error(`${subcommand} requires a claim ID.`);
    if (subcommand === 'renew') {
      output(renewWorkClaim(activeWorkPath, id, {
        ...identity,
        force: values.force === true,
        ttlSeconds: parseTtl(clean(values.ttl)),
      }), json);
      return 0;
    }
    if (subcommand === 'release' || subcommand === 'finish') {
      output(releaseWorkClaim(activeWorkPath, id, {
        ...identity,
        force: values.force === true,
        note: clean(values.note),
      }), json);
      return 0;
    }

    throw new Error(`Unknown work subcommand: ${subcommand}`);
  } catch (error: any) {
    process.stderr.write(`canopytag work: ${error.message}\n`);
    return 1;
  }
}

const isDirectRun = process.argv[1]?.endsWith('work.ts') || process.argv[1]?.endsWith('work.js');
if (isDirectRun) process.exitCode = runWorkCli(process.argv.slice(2));
