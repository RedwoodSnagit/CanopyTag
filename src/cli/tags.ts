#!/usr/bin/env node
/**
 * canopytag tags - browse and review tag vocabulary health
 *
 * Usage:
 *   canopytag tags
 *   canopytag tags --search auth
 *   canopytag tags --health
 */

import { parseArgs } from 'node:util';
import { readCanopy } from '../backend/lib/canopy.js';
import { CORE_OPTIONS, resolveCanopyPath } from './shared.js';
import { buildTags, buildTagHealth, readTagVocabularyForCanopy } from '../mcp/tools/tags.js';

export function runTagsCli() {
  const { values } = parseArgs({
    options: {
      ...CORE_OPTIONS,
      search: { type: 'string' },
      limit: { type: 'string', short: 'n' },
      all: { type: 'boolean', short: 'a' },
      health: { type: 'boolean' },
      'max-file-tags': { type: 'string' },
      'max-feature-spread': { type: 'string' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`canopytag tags - browse and review tag vocabulary

Usage:
  canopytag tags [--repo <path>]
  canopytag tags --search <term>
  canopytag tags --health

Options:
  -r, --repo <path>          Repo root (default: cwd)
      --search <term>        Substring filter for tag names
  -n, --limit <count>        Number of tags to show (default: 20)
  -a, --all                  Show all tags
      --health               Soft hygiene report for tag drift
      --max-file-tags <n>    Warn when a file has at least this many tags (default: 7)
      --max-feature-spread <n>
                              Warn when a tag spans more than this many features (default: 4)
  -h, --help                 Show this help`);
    return;
  }

  const canopyPath = resolveCanopyPath(values.repo as string | undefined);
  const canopy = readCanopy(canopyPath);

  if (values.health) {
    const vocabulary = readTagVocabularyForCanopy(canopyPath);
    console.log(buildTagHealth(canopy, vocabulary, {
      maxFileTags: parseInt(values['max-file-tags'] as string, 10) || undefined,
      maxFeatureSpread: parseInt(values['max-feature-spread'] as string, 10) || undefined,
    }));
    return;
  }

  console.log(buildTags(
    canopy,
    values.search as string | undefined,
    parseInt(values.limit as string, 10) || undefined,
    !!values.all,
  ));
}

const isDirectRun = process.argv[1]?.endsWith('tags.ts') || process.argv[1]?.endsWith('tags.js');
if (isDirectRun) runTagsCli();
