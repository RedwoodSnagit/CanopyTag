#!/usr/bin/env node
/**
 * canopytag hook install — merge analytics PostToolUse hook into .claude/settings.json
 *
 * Usage:
 *   canopytag hook install
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseJsonFile } from '../backend/lib/canopy.js';

const HOOK_MATCHER = 'Read|Edit|Write|Grep|Glob|Bash';

function getHookCommand(): string {
  const canopytagRoot = path.resolve(import.meta.dirname, '../..');
  const hookPath = path.join(canopytagRoot, 'hooks', 'canopytag-analytics.mjs').replace(/\\/g, '/');
  return `node "${hookPath}"`;
}

function buildHookEntry() {
  return {
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: getHookCommand() }],
  };
}

function isCanopyTagHookEntry(entry: any): boolean {
  const command = entry?.hooks?.[0]?.command;
  return typeof command === 'string' && command.includes('canopytag-analytics.mjs');
}

function run() {
  const settingsPath = path.join(process.cwd(), '.claude', 'settings.json');

  let settings: Record<string, any> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = parseJsonFile(settingsPath) as Record<string, any>;
    } catch {
      console.error('Error: .claude/settings.json exists but is not valid JSON.');
      process.exit(1);
    }
  }

  const hookEntry = buildHookEntry();

  // Check if already installed
  const existing: any[] = settings?.hooks?.PostToolUse ?? [];
  const existingEntry = existing.find(isCanopyTagHookEntry);
  const alreadyInstalled = Boolean(existingEntry);

  if (
    existingEntry &&
    (existingEntry.matcher !== hookEntry.matcher || existingEntry.hooks?.[0]?.command !== hookEntry.hooks[0].command)
  ) {
    existingEntry.matcher = hookEntry.matcher;
    existingEntry.hooks = hookEntry.hooks;
    const tmp = settingsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, settingsPath);
    console.log('Analytics hook updated in .claude/settings.json');
    console.log(`Hook matcher: ${hookEntry.matcher}`);
    console.log(`Hook command: ${hookEntry.hooks[0].command}`);
    console.log('Note: .claude/settings.json may contain local absolute paths. Keep it uncommitted or review it before sharing a public repo.');
    process.exit(0);
  }

  if (alreadyInstalled) {
    console.log('Analytics hook already installed in .claude/settings.json');
    console.log('Note: .claude/settings.json may contain local absolute paths. Keep it uncommitted or review it before sharing a public repo.');
    process.exit(0);
  }

  // Merge without clobbering existing hooks
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse.push(hookEntry);

  // Ensure .claude/ directory exists
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, settingsPath);

  console.log(`Analytics hook installed in .claude/settings.json`);
  console.log(`Hook command: ${hookEntry.hooks[0].command}`);
  console.log(`MCP config is separate: run \`canopytag mcp --repo ${process.cwd()}\` to scaffold .mcp.json.`);
  console.log('Note: .claude/settings.json may contain local absolute paths. Keep it uncommitted or review it before sharing a public repo.');
}

run();
