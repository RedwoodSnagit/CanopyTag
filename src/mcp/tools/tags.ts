import fs from 'node:fs';
import path from 'node:path';
import type { Canopy } from '../../shared/types.js';
import { parseJsonFile } from '../../backend/lib/canopy.js';

export interface TagVocabularyEntry {
  name: string;
  description?: string;
  aliases: string[];
  status?: string;
}

export interface TagVocabulary {
  entries: Map<string, TagVocabularyEntry>;
  aliases: Map<string, string>;
  source: 'missing' | 'array' | 'object';
  path?: string;
}

export interface TagHealthOptions {
  maxFileTags?: number;
  maxFeatureSpread?: number;
}

/** Collect all tags from canopy with usage counts */
export function collectTags(canopy: Canopy): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fc of Object.values(canopy.files)) {
    for (const tag of fc.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

function cleanTagName(tag: unknown): string | undefined {
  if (typeof tag !== 'string') return undefined;
  const trimmed = tag.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function addVocabularyEntry(
  entries: Map<string, TagVocabularyEntry>,
  aliases: Map<string, string>,
  name: string,
  value: unknown,
) {
  const tagName = cleanTagName(name);
  if (!tagName) return;

  const entry: TagVocabularyEntry = { name: tagName, aliases: [] };
  if (typeof value === 'string') {
    entry.description = value.trim() || undefined;
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.description === 'string') {
      entry.description = record.description.trim() || undefined;
    }
    if (typeof record.status === 'string') {
      entry.status = record.status;
    }
    if (Array.isArray(record.aliases)) {
      entry.aliases = record.aliases
        .map(cleanTagName)
        .filter((alias): alias is string => !!alias && alias !== tagName);
    }
  }

  entries.set(tagName, entry);
  for (const alias of entry.aliases) {
    aliases.set(alias, tagName);
  }
}

export function parseTagVocabulary(raw: unknown, source: TagVocabulary['source'] = 'object', filePath?: string): TagVocabulary {
  const entries = new Map<string, TagVocabularyEntry>();
  const aliases = new Map<string, string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        const name = cleanTagName(item);
        if (name) entries.set(name, { name, aliases: [] });
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const name = cleanTagName(record.name ?? record.tag);
        if (name) addVocabularyEntry(entries, aliases, name, record);
      }
    }
    return { entries, aliases, source: 'array', path: filePath };
  }

  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.tags)) {
      return parseTagVocabulary(record.tags, 'array', filePath);
    }
    const tags = record.tags && typeof record.tags === 'object' && !Array.isArray(record.tags)
      ? record.tags as Record<string, unknown>
      : record;

    for (const [name, value] of Object.entries(tags)) {
      addVocabularyEntry(entries, aliases, name, value);
    }
    return { entries, aliases, source, path: filePath };
  }

  return { entries, aliases, source: 'missing', path: filePath };
}

export function readTagVocabularyForCanopy(canopyPath: string): TagVocabulary {
  const tagsPath = path.join(path.dirname(canopyPath), 'tags.json');
  if (!fs.existsSync(tagsPath)) {
    return { entries: new Map(), aliases: new Map(), source: 'missing', path: tagsPath };
  }
  return parseTagVocabulary(parseJsonFile(tagsPath), 'object', tagsPath);
}

/** Filter and sort tags. No search = top N by count. Search = substring match, alphabetical. */
export function searchTags(
  tags: Map<string, number>,
  search?: string,
  limit: number = 20,
  all: boolean = false,
): [string, number][] {
  let entries = [...tags.entries()];

  if (search) {
    const lower = search.toLowerCase();
    entries = entries.filter(([name]) => name.toLowerCase().includes(lower));
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  } else {
    entries.sort((a, b) => b[1] - a[1]);  // count descending
  }

  if (!all) {
    entries = entries.slice(0, limit);
  }
  return entries;
}

/** Levenshtein distance -- simple implementation for short strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalize tag separators for comparison */
export function normalizeSeparators(tag: string): string {
  return tag.replace(/[-_]/g, '').toLowerCase();
}

/** Find likely duplicate tag pairs */
export function findDuplicates(tags: Map<string, number>): [string, string][] {
  const names = [...tags.keys()];
  const dupes: [string, string][] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;

      // Check separator normalization
      if (normalizeSeparators(a) === normalizeSeparators(b)) {
        dupes.push([a, b]);
        seen.add(key);
        continue;
      }

      // Check likely typos. Short tags need a stricter threshold so unrelated
      // abbreviations such as "api" and "cli" do not look like duplicates.
      const maxLen = Math.max(a.length, b.length);
      const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
      const typoThreshold = maxLen <= 4 ? 1 : 2;
      if (distance <= typoThreshold) {
        dupes.push([a, b]);
        seen.add(key);
      }
    }
  }
  return dupes;
}

/** Build the full tags tool output */
export function buildTags(
  canopy: Canopy,
  search?: string,
  limit?: number,
  all?: boolean,
): string {
  const tags = collectTags(canopy);
  if (tags.size === 0) return 'No tags in use.';

  const results = searchTags(tags, search, limit ?? 20, all ?? false);
  const lines: string[] = [];

  if (search) {
    lines.push(`Tags matching "${search}":`);
  } else {
    lines.push(`Top ${results.length} tags (${tags.size} total):`);
  }

  for (const [name, count] of results) {
    lines.push(`  ${count.toString().padStart(3)}  ${name}`);
  }

  if (!all && !search && results.length < tags.size) {
    lines.push(`\n${tags.size - results.length} more -- use all=true or search to narrow`);
  }

  // Fuzzy duplicate warnings (scoped to visible results when searching)
  const dupes = findDuplicates(tags);
  const resultNames = new Set(results.map(([name]) => name));
  const relevantDupes = search
    ? dupes.filter(([a, b]) => resultNames.has(a) || resultNames.has(b))
    : dupes;
  if (relevantDupes.length > 0) {
    lines.push('');
    lines.push('Possible duplicates:');
    for (const [a, b] of relevantDupes) {
      lines.push(`  ${a} ~ ${b}`);
    }
  }

  return lines.join('\n');
}

function tagFileMap(canopy: Canopy): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const [filePath, fc] of Object.entries(canopy.files)) {
    for (const tag of fc.tags ?? []) {
      if (!files.has(tag)) files.set(tag, []);
      files.get(tag)!.push(filePath);
    }
  }
  return files;
}

function tagFeatureSpread(canopy: Canopy): Map<string, Set<string>> {
  const spread = new Map<string, Set<string>>();
  for (const fc of Object.values(canopy.files)) {
    const feature = fc.featureId ?? '(none)';
    for (const tag of fc.tags ?? []) {
      if (!spread.has(tag)) spread.set(tag, new Set());
      spread.get(tag)!.add(feature);
    }
  }
  return spread;
}

function isInactiveVocabularyEntry(entry: TagVocabularyEntry): boolean {
  return entry.status === 'deprecated' || entry.status === 'archived';
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function buildTagHealth(
  canopy: Canopy,
  vocabulary: TagVocabulary = { entries: new Map(), aliases: new Map(), source: 'missing' },
  options: TagHealthOptions = {},
): string {
  const maxFileTags = options.maxFileTags ?? 7;
  const maxFeatureSpread = options.maxFeatureSpread ?? 4;
  const usage = collectTags(canopy);
  const filesByTag = tagFileMap(canopy);
  const spreadByTag = tagFeatureSpread(canopy);
  const annotatedFiles = Object.keys(canopy.files).length;
  const lines: string[] = [];

  lines.push('Tag Health');
  lines.push(`  ${formatCount(usage.size, 'tag')} in use across ${formatCount(annotatedFiles, 'annotated file')}`);
  if (vocabulary.source === 'missing' || vocabulary.entries.size === 0) {
    lines.push('  No tags.json vocabulary found; using canopy.json tags as the organic vocabulary.');
  } else {
    const label = vocabulary.source === 'array' ? 'declared tag' : 'declared vocabulary tag';
    lines.push(`  ${formatCount(vocabulary.entries.size, label)} in tags.json`);
  }
  lines.push('  Soft warnings only: agents can still propose tags; humans keep the vocabulary clean.');

  if (usage.size === 0) {
    lines.push('');
    lines.push('No tags in use yet.');
    return lines.join('\n');
  }

  const hasDeclaredVocabulary = vocabulary.entries.size > 0;
  const unknownTags = hasDeclaredVocabulary
    ? [...usage.entries()]
      .filter(([tag]) => !vocabulary.entries.has(tag) && !vocabulary.aliases.has(tag))
      .sort((a, b) => b[1] - a[1])
    : [];
  const aliasesInUse = hasDeclaredVocabulary
    ? [...usage.entries()]
      .filter(([tag]) => vocabulary.aliases.has(tag))
      .sort((a, b) => b[1] - a[1])
    : [];
  const unusedDeclared = hasDeclaredVocabulary
    ? [...vocabulary.entries.values()]
      .filter(entry => !isInactiveVocabularyEntry(entry) && !usage.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const missingDescriptions = vocabulary.source === 'object'
    ? [...vocabulary.entries.values()]
      .filter(entry => !isInactiveVocabularyEntry(entry) && !entry.description)
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const duplicatePairs = findDuplicates(usage)
    .filter(([a, b]) => vocabulary.aliases.get(a) !== b && vocabulary.aliases.get(b) !== a);
  const singletonTags = [...usage.entries()]
    .filter(([, count]) => count === 1)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const crowdedFiles = Object.entries(canopy.files)
    .map(([filePath, fc]) => ({ filePath, tags: fc.tags ?? [] }))
    .filter(row => row.tags.length >= maxFileTags)
    .sort((a, b) => b.tags.length - a.tags.length || a.filePath.localeCompare(b.filePath));
  const broadTags = [...spreadByTag.entries()]
    .map(([tag, features]) => ({ tag, features: [...features].sort(), count: usage.get(tag) ?? 0 }))
    .filter(row => row.features.length > maxFeatureSpread && row.count > row.features.length)
    .sort((a, b) => b.features.length - a.features.length || b.count - a.count);

  const warningCount =
    unknownTags.length +
    aliasesInUse.length +
    duplicatePairs.length +
    crowdedFiles.length +
    broadTags.length +
    missingDescriptions.length;

  lines.push('');
  if (warningCount === 0) {
    lines.push('No high-signal tag hygiene issues found.');
  } else {
    lines.push(`${formatCount(warningCount, 'hygiene signal')} found.`);
  }

  if (unknownTags.length > 0) {
    lines.push('');
    lines.push('Unknown tags (not in tags.json):');
    for (const [tag, count] of unknownTags.slice(0, 15)) {
      lines.push(`  ${tag} (${formatCount(count, 'file')})`);
    }
    if (unknownTags.length > 15) lines.push(`  ...${unknownTags.length - 15} more`);
  }

  if (aliasesInUse.length > 0) {
    lines.push('');
    lines.push('Aliases in use (prefer canonical tags):');
    for (const [tag, count] of aliasesInUse.slice(0, 15)) {
      lines.push(`  ${tag} -> ${vocabulary.aliases.get(tag)} (${formatCount(count, 'file')})`);
    }
  }

  if (duplicatePairs.length > 0) {
    lines.push('');
    lines.push('Possible duplicates:');
    for (const [a, b] of duplicatePairs.slice(0, 15)) {
      lines.push(`  ${a} ~ ${b}`);
    }
  }

  if (singletonTags.length > 0) {
    lines.push('');
    lines.push('Singleton tags (review if these are one-offs or early vocabulary):');
    for (const [tag] of singletonTags.slice(0, 15)) {
      const file = filesByTag.get(tag)?.[0] ?? 'unknown file';
      lines.push(`  ${tag} -> ${file}`);
    }
    if (singletonTags.length > 15) lines.push(`  ...${singletonTags.length - 15} more`);
  }

  if (crowdedFiles.length > 0) {
    lines.push('');
    lines.push(`Files with ${maxFileTags}+ tags (multi-label is fine; review for tag stuffing):`);
    for (const row of crowdedFiles.slice(0, 10)) {
      lines.push(`  ${row.tags.length} tags  ${row.filePath}`);
    }
  }

  if (broadTags.length > 0) {
    lines.push('');
    lines.push(`Broad tags spanning more than ${maxFeatureSpread} features:`);
    for (const row of broadTags.slice(0, 10)) {
      lines.push(`  ${row.tag} (${formatCount(row.count, 'file')}, ${formatCount(row.features.length, 'feature')})`);
    }
  }

  if (unusedDeclared.length > 0) {
    lines.push('');
    lines.push('Declared but unused tags:');
    for (const entry of unusedDeclared.slice(0, 15)) {
      lines.push(`  ${entry.name}`);
    }
    if (unusedDeclared.length > 15) lines.push(`  ...${unusedDeclared.length - 15} more`);
  }

  if (missingDescriptions.length > 0) {
    lines.push('');
    lines.push('Declared tags missing descriptions:');
    for (const entry of missingDescriptions.slice(0, 15)) {
      lines.push(`  ${entry.name}`);
    }
  }

  lines.push('');
  lines.push('Suggested loop: browse tags, rename/merge obvious duplicates, then add aliases or descriptions in tags.json for terms agents keep proposing.');

  return lines.join('\n');
}
