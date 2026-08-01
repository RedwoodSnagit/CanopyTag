import { describe, expect, it } from 'vitest';
import { CATALOGUE_SEARCH_MAX_RESULTS, searchCatalogue } from './catalogue-search';
import type { Canopy, FileCanopy } from './types';

const CREATED_BY = { name: 'test', role: 'human' as const };

function canopyWith(files: Record<string, FileCanopy>): Canopy {
  return {
    version: 1,
    repoRoot: '.',
    lastModifiedAt: '2026-08-01T00:00:00Z',
    files,
    features: {
      physiology: {
        name: 'Physiology Engine',
        description: 'Models athlete lactate dynamics.',
        tags: ['metabolism'],
      },
    },
  };
}

const SEARCH_CANOPY = canopyWith({
  'src/power/model.ts': {
    title: 'Aerobic Power Model',
    summary: 'Estimates sustainable output from physiological state.',
    tags: ['simulation'],
    featureId: 'physiology',
    todos: [
      {
        id: 'todo-open', text: 'Calibrate mitochondrial response', priority: 2,
        status: 'open', tags: ['validation'], createdAt: '2026-07-01T00:00:00Z', createdBy: CREATED_BY,
      },
      {
        id: 'todo-done', text: 'Remove obsolete peloton coefficient', priority: 4,
        status: 'done', createdAt: '2026-06-01T00:00:00Z', createdBy: CREATED_BY,
      },
    ],
    lifecycleMarks: [
      {
        id: 'active', type: 'provisional', reason: 'Pending altitude validation',
        createdAt: '2026-07-01T00:00:00Z', createdBy: CREATED_BY,
      },
      {
        id: 'resolved', type: 'review_needed', state: 'resolved', reason: 'Legacy cadence concern',
        createdAt: '2026-06-01T00:00:00Z', createdBy: CREATED_BY,
        resolvedAt: '2026-07-01T00:00:00Z',
      },
    ],
    comments: [
      { text: 'Finding: boundary condition is surprising', type: 'finding', author: CREATED_BY, createdAt: '2026-07-01T00:00:00Z' },
      { text: 'Ordinary prose should stay private', type: 'note', author: CREATED_BY, createdAt: '2026-07-01T00:00:00Z' },
    ],
    relatedFiles: ['secret/related-only-neutrino.ts'],
  },
  'docs/recovery.md': {
    title: 'Recovery Guide',
    summary: 'Explains adaptation after training.',
    comments: [
      // Exercise tolerant read support for a legacy warning value.
      { text: 'Warning about autonomic fatigue', type: 'warning' as any, author: CREATED_BY, createdAt: '2026-07-02T00:00:00Z' },
    ],
  },
});

const OPTIONS = { asOfDate: '2026-08-01' };

describe('searchCatalogue', () => {
  it.each([
    ['power/model', 'path'],
    ['Aerobic', 'title'],
    ['sustainable', 'summary'],
    ['simulation', 'tags'],
    ['Physiology', 'feature_name'],
    ['lactate', 'feature_description'],
    ['mitochondrial', 'todo_text'],
    ['validation', 'todo_tags'],
    ['altitude', 'lifecycle_reason'],
    ['boundary', 'comments'],
    ['autonomic', 'comments'],
  ] as const)('finds %s in the authored %s field', (query, field) => {
    const hits = searchCatalogue(SEARCH_CANOPY, query, OPTIONS);

    expect(hits[0]?.matchedFields).toContain(field);
  });

  it('excludes completed TODOs, resolved lifecycle reasons, ordinary comments, and relationship paths', () => {
    expect(searchCatalogue(SEARCH_CANOPY, 'peloton', OPTIONS)).toEqual([]);
    expect(searchCatalogue(SEARCH_CANOPY, 'cadence', OPTIONS)).toEqual([]);
    expect(searchCatalogue(SEARCH_CANOPY, 'private', OPTIONS)).toEqual([]);
    expect(searchCatalogue(SEARCH_CANOPY, 'neutrino', OPTIONS)).toEqual([]);
  });

  it('supports prefix matching and typo tolerance only for sufficiently long terms', () => {
    expect(searchCatalogue(SEARCH_CANOPY, 'mitochon', OPTIONS)[0]?.path).toBe('src/power/model.ts');
    expect(searchCatalogue(SEARCH_CANOPY, 'physiolgy', OPTIONS)[0]?.path).toBe('src/power/model.ts');
    expect(searchCatalogue(SEARCH_CANOPY, 'pwoer', OPTIONS)).toEqual([]);
  });

  it('reports visible matched fields and actual matched terms', () => {
    const [hit] = searchCatalogue(SEARCH_CANOPY, 'physiology', OPTIONS);

    expect(hit.matchedFields).toEqual(['feature_name']);
    expect(hit.matchedTerms).toContain('physiology');
  });

  it('indexes a feature description only on its normalized canonical file', () => {
    const canopy = canopyWith({
      'docs/physiology.md': { featureId: 'physiology' },
      'src/power/model.ts': { featureId: 'physiology' },
    });
    canopy.features.physiology.canonicalFile = '.\\docs\\physiology.md';

    expect(searchCatalogue(canopy, 'lactate', OPTIONS).map(hit => hit.path))
      .toEqual(['docs/physiology.md']);
  });

  it('keeps feature names searchable from every member when a canonical file is declared', () => {
    const canopy = canopyWith({
      'docs/physiology.md': { featureId: 'physiology' },
      'src/power/model.ts': { featureId: 'physiology' },
    });
    canopy.features.physiology.canonicalFile = 'docs/physiology.md';

    expect(searchCatalogue(canopy, 'Physiology', OPTIONS).map(hit => hit.path).sort())
      .toEqual(['docs/physiology.md', 'src/power/model.ts']);
  });

  it('keeps legacy feature-description indexing when no canonical file is declared', () => {
    const canopy = canopyWith({
      'docs/physiology.md': { featureId: 'physiology' },
      'src/power/model.ts': { featureId: 'physiology' },
    });

    expect(searchCatalogue(canopy, 'lactate', OPTIONS).map(hit => hit.path).sort())
      .toEqual(['docs/physiology.md', 'src/power/model.ts']);
  });

  it('ranks a title match above a lower-boost comment match', () => {
    const canopy = canopyWith({
      'title.md': { title: 'Torque' },
      'comment.md': {
        comments: [{ text: 'Torque', type: 'finding', author: CREATED_BY, createdAt: '2026-07-01T00:00:00Z' }],
      },
    });

    expect(searchCatalogue(canopy, 'torque', OPTIONS).map(hit => hit.path)).toEqual(['title.md', 'comment.md']);
  });

  it('enforces a hard result ceiling even when the caller asks for more', () => {
    const files = Object.fromEntries(
      Array.from({ length: CATALOGUE_SEARCH_MAX_RESULTS + 25 }, (_, index) => [
        `docs/${index}.md`, { summary: 'common catalogue term' },
      ]),
    );

    expect(searchCatalogue(canopyWith(files), 'common', { ...OPTIONS, limit: 1_000 }))
      .toHaveLength(CATALOGUE_SEARCH_MAX_RESULTS);
  });
});
