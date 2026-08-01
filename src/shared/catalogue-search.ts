import MiniSearch from 'minisearch';
import { assessLifecycleMarks } from './lifecycle.js';
import type { Canopy, Feature, FileCanopy } from './types.js';

export const CATALOGUE_SEARCH_DEFAULT_LIMIT = 10;
export const CATALOGUE_SEARCH_MAX_RESULTS = 100;

export const CATALOGUE_SEARCH_FIELDS = [
  'path',
  'title',
  'summary',
  'tags',
  'feature_name',
  'feature_description',
  'todo_text',
  'todo_tags',
  'lifecycle_reason',
  'comments',
] as const;

export type CatalogueSearchField = typeof CATALOGUE_SEARCH_FIELDS[number];

interface CatalogueSearchDocument extends Record<CatalogueSearchField, string> {
  id: string;
}

export interface CatalogueSearchHit {
  path: string;
  title?: string;
  score: number;
  matchedFields: CatalogueSearchField[];
  matchedTerms: string[];
}

export interface CatalogueSearchOptions {
  /** Required so lifecycle interpretation stays deterministic and testable. */
  asOfDate: string;
  limit?: number;
}

const FIELD_BOOSTS: Record<CatalogueSearchField, number> = {
  path: 5,
  title: 5,
  summary: 3,
  tags: 4,
  feature_name: 4,
  feature_description: 2.5,
  todo_text: 2.5,
  todo_tags: 3,
  lifecycle_reason: 2,
  comments: 2,
};

function findFeature(canopy: Canopy, featureId: string | undefined): Feature | undefined {
  if (!featureId) return undefined;
  const direct = canopy.features[featureId] ?? canopy.features[featureId.toLowerCase()];
  if (direct) return direct;

  const target = featureId.toLowerCase();
  return Object.entries(canopy.features)
    .find(([id]) => id.toLowerCase() === target)?.[1];
}

function normalizeCataloguePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function activeLifecycleReasons(fc: FileCanopy, asOfDate: string): string {
  return assessLifecycleMarks(fc.lifecycleMarks, asOfDate)
    .filter(({ state }) => state === 'open' || state === 'due' || state === 'expired')
    .map(({ mark }) => mark?.reason)
    .filter((reason): reason is string => Boolean(reason))
    .join(' ');
}

function searchableComments(fc: FileCanopy): string {
  return (fc.comments ?? [])
    .filter(comment => {
      // `warning` appeared in early hand-authored catalogues before CommentType
      // was narrowed. Tolerate it at read time without expanding the write schema.
      const type = comment.type as string | undefined;
      return type === 'finding' || type === 'bug' || type === 'warning';
    })
    .map(comment => comment.text)
    .join(' ');
}

function buildSearchDocument(
  canopy: Canopy,
  filePath: string,
  fc: FileCanopy,
  asOfDate: string,
): CatalogueSearchDocument {
  const feature = findFeature(canopy, fc.featureId);
  const includeFeatureDescription = !feature?.canonicalFile
    || normalizeCataloguePath(feature.canonicalFile) === normalizeCataloguePath(filePath);
  const openTodos = (fc.todos ?? [])
    .filter(todo => todo.status === 'open' || todo.status === 'in_progress');

  return {
    id: filePath,
    path: filePath,
    title: fc.title ?? '',
    summary: fc.summary ?? '',
    tags: [...(fc.tags ?? []), ...(feature?.tags ?? [])].join(' '),
    feature_name: feature?.name ?? '',
    feature_description: includeFeatureDescription ? feature?.description ?? '' : '',
    todo_text: openTodos.map(todo => todo.text).join(' '),
    todo_tags: openTodos.flatMap(todo => todo.tags ?? []).join(' '),
    lifecycle_reason: activeLifecycleReasons(fc, asOfDate),
    comments: searchableComments(fc),
  };
}

function boundedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return CATALOGUE_SEARCH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(CATALOGUE_SEARCH_MAX_RESULTS, Math.floor(limit!)));
}

/**
 * Search only authored CanopyTag catalogue fields. This deliberately excludes
 * relatedFiles: relationships are traversal edges, not prose search evidence.
 */
export function searchCatalogue(
  canopy: Canopy,
  query: string,
  options: CatalogueSearchOptions,
): CatalogueSearchHit[] {
  if (!query.trim()) return [];

  const documents = Object.entries(canopy.files)
    .map(([filePath, fc]) => buildSearchDocument(canopy, filePath, fc, options.asOfDate));

  const index = new MiniSearch<CatalogueSearchDocument>({
    fields: [...CATALOGUE_SEARCH_FIELDS],
    storeFields: ['title'],
  });
  index.addAll(documents);

  return index.search(query, {
    boost: FIELD_BOOSTS,
    prefix: term => term.length >= 3,
    fuzzy: term => term.length >= 6 ? 0.2 : false,
    maxFuzzy: 2,
    weights: { prefix: 0.8, fuzzy: 0.55 },
  })
    .slice(0, boundedLimit(options.limit))
    .map(result => {
      const fields = new Set<CatalogueSearchField>();
      for (const matchedFields of Object.values(result.match)) {
        for (const field of matchedFields) {
          if ((CATALOGUE_SEARCH_FIELDS as readonly string[]).includes(field)) {
            fields.add(field as CatalogueSearchField);
          }
        }
      }

      return {
        path: String(result.id),
        title: typeof result.title === 'string' && result.title.length > 0
          ? result.title
          : undefined,
        score: result.score,
        matchedFields: CATALOGUE_SEARCH_FIELDS.filter(field => fields.has(field)),
        matchedTerms: [...new Set(result.terms)].sort(),
      };
    });
}
